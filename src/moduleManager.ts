import DB from "./database/db";
import { ModuleActionDescriptor } from "./interfaces/moduleDescriptor";

export default class ModuleManager {
    static loadedModules: { instance: any, moduleName: string }[] = [];

    static registerModule(instance: any, moduleName: string): void {
        let alreadyLoaded = this.loadedModules.find(m => m.moduleName === moduleName);
        if (alreadyLoaded) {
            console.warn(`Module ${moduleName} is already registered.`);
            return;
        }

        this.loadedModules.push({ instance, moduleName });
    }

    static getAvailableActions(moduleName: string): any[] {
        let module = this.loadedModules.find(m => m.moduleName === moduleName);
        if (!module) {
            console.warn(`Module ${moduleName} is not registered.`);
            return [];
        }        

        return module.instance.getActionDescriptors();
    }

    static getUserData(userId: string): any {
        let userDataMap: { [key: string]: any } = {};

        for (let mod of this.loadedModules) {
            let allowInterop = DB.getPlainValue(`MODULE.${mod.moduleName}.settings.allowModuleInterop`);
            if (allowInterop && typeof mod.instance.getUserData === "function") {
                let userData = mod.instance.getUserData(userId);
                if (userData) {
                    Object.assign(userDataMap, userData);
                }
            }
        }

        return userDataMap;
    }

    static handleSteps(userId: string, steps: string, params: { [key: string]: any }): void {
        for (let mod of this.loadedModules) {
            let actions: ModuleActionDescriptor[] = mod.instance.getActionDescriptors();

            for (let step of steps) {
                let action = actions.find(a => a.name === step);
                if (action) {
                    if (action.handler.startsWith("@")) {
                        let methodName = action.handler.substring(1);
                        if (typeof mod.instance[methodName] === "function") {
                            mod.instance[methodName](userId, params);
                        }
                    } else if (action.handler.startsWith("#")) {
                        let methodName = action.handler.substring(1);
                        if (typeof mod.instance[methodName] === "function") {
                            mod.instance[methodName](userId, params);
                        }
                    }
                }
            }
        }
    }
}