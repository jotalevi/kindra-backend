#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

// Usage: node scripts/supervisor.js [path/to/script]
const target = process.argv[2] || path.join('dist', 'index.js');
let restartDelay = 1000; // start with 1s

function start() {
  const child = spawn(process.execPath, [target], { stdio: 'inherit' });

  child.on('exit', (code, signal) => {
    // If child exited cleanly, exit supervisor as well
    if (code === 0) {
      console.log('Child exited with code 0, exiting supervisor.');
      process.exit(0);
    }

    if (code === 3) {
        console.log('Child requested clean restart, restarting immediately.');
        start();
        return;
    }

    console.error(`Child exited with code ${code} signal ${signal}. Restarting in ${restartDelay}ms`);

    setTimeout(() => {
      // exponential backoff (cap at 30s)
      restartDelay = Math.min(restartDelay * 2, 30000);
      start();
    }, restartDelay);
  });

  child.on('error', (err) => {
    console.error('Failed to start child process:', err);
    setTimeout(start, restartDelay);
  });
}

start();
