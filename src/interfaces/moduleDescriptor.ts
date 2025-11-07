class ModuleActionDescriptor {
    name: string;
    parameters: string[];
    handler: string;

    constructor(name: string, parameters: string[], handler: string) {
        this.name = name;
        this.parameters = parameters;
        this.handler = handler;
    }
}

export { ModuleActionDescriptor };

export default class ModuleDescriptor {
    instance: object;
    moduleName: string;
    path: string;
    displayName: string;
    actions: ModuleActionDescriptor[];

    constructor(instance: object, moduleName: string, path: string, displayName: string, actions: ModuleActionDescriptor[]) {
        this.instance = instance;
        this.moduleName = moduleName;
        this.path = path;
        this.displayName = displayName;
        this.actions = actions;
    }
}

