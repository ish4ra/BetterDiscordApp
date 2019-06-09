import {SettingsConfig, SettingsState} from "data";
import DataStore from "./datastore";
import BdApi from "./pluginapi";
import Events from "./emitter";
import WebpackModules, {DiscordModules} from "./webpackmodules";

import {SettingsPanel as SettingsRenderer} from "ui";
import Utilities from "./utilities";
import {Toasts} from "ui";

export default new class SettingsManager {

    constructor() {
        this.config = SettingsConfig;
        this.state = SettingsState;
        this.collections = [];
        this.panels = [];
        this.registerCollection("settings", "Settings", SettingsConfig);
    }

    initialize() {
        DataStore.initialize();
        this.loadSettings();
        this.patchSections();
    }

    registerCollection(id, name, settings, button = null) {
        if (this.collections.find(c => c.id == id)) Utilities.err("Settings", "Already have a collection with id " + id);
        this.collections.push({
            type: "collection",
            id: id,
            name: name,
            settings: settings,
            button: button
        });
        this.setup();
    }

    removeCollection(id) {
        const location = this.collections.findIndex(c => c.id == id);
        if (!location < 0) Utilities.err("Settings", "No collection with id " + id);
        this.collections.splice(location, 1);
    }

    registerPanel(name, options) {
        const {element, onClick} = options;
        const section = {label: name, section: name};
        if (onClick) section.onClick = onClick;
        else section.element = element instanceof DiscordModules.React.Component ? () => DiscordModules.React.createElement(element, {}) : typeof(element) == "function" ? element : () => element;
        this.panels.push(section);
    }

    getPath(path, collectionId = "", categoryId = "") {
        const collection = path.length == 3 ? path[0] : collectionId;
        const category = path.length == 3 ? path[1] : path.length == 2 ? path[0] : categoryId;
        const setting = path[path.length - 1];
        return {collection, category, setting};
    }

    setup() {
        for (let c = 0; c < this.collections.length; c++) {
            const collection = this.collections[c];
            const categories = this.collections[c].settings;
            if (!this.state[collection.id]) this.state[collection.id] = {};
            for (let s = 0; s < categories.length; s++) {
                const category = categories[s];
                if (category.type != "category") {if (!this.state[collection.id].hasOwnProperty(category.id)) this.state[collection.id][category.id] = category.value;}
                else {
                    if (!this.state[collection.id].hasOwnProperty(category.id)) this.state[collection.id][category.id] = {};
                    for (let s = 0; s < category.settings.length; s++) {
                        const setting = category.settings[s];
                        if (!this.state[collection.id][category.id].hasOwnProperty(setting.id)) this.state[collection.id][category.id][setting.id] = setting.value;
                        if (setting.enableWith) {
                            const path = this.getPath(setting.enableWith.split("."), collection.id, category.id);
                            if (setting.hasOwnProperty("disabled")) continue;
                            Object.defineProperty(setting, "disabled", {
                                get: () => {
                                    return !this.state[path.collection][path.category][path.setting];
                                }
                            });
                        }
                    }
                }
            }
            if (collection.enableWith) {
                const path = this.getPath(collection.enableWith.split("."));
                Object.defineProperty(collection, "disabled", {
                    get: () => {
                        return !this.state[path.collection][path.category][path.setting];
                    }
                });
            }
        }
    }

    async patchSections() {
        const UserSettings = await this.getUserSettings();
        Utilities.monkeyPatch(UserSettings.prototype, "generateSections", {after: (data) => {
            let location = data.returnValue.findIndex(s => s.section.toLowerCase() == "linux") + 1;
            const insert = (section) => {
                data.returnValue.splice(location, 0, section);
                location++;
            };
            console.log(data); /* eslint-disable-line no-console */
            insert({section: "DIVIDER"});
            insert({section: "HEADER", label: "BandagedBD"});
            for (const collection of this.collections) {
                if (collection.disabled) continue;
                insert({
                    section: collection.name,
                    label: collection.name,
                    element: () => SettingsRenderer.buildSettingsPanel(collection.name, collection.settings, SettingsState[collection.id], this.onSettingChange.bind(this, collection.id), collection.button ? collection.button : null)
                });
            }
            for (const panel of this.panels) insert(panel);
            insert({section: "BBD Test", label: "Test Tab", onClick: function() {Toasts.success("This can just be a click listener!", {forceShow: true});}});
            insert({section: "CUSTOM", element: () => SettingsRenderer.attribution});
        }});
        this.forceUpdate();
    }

    forceUpdate() {
        const viewClass = WebpackModules.getByProps("standardSidebarView").standardSidebarView.split(" ")[0];
        const node = document.querySelector(`.${viewClass}`);
        Utilities.getInternalInstance(node).return.return.return.return.return.return.stateNode.forceUpdate();
    }

    getUserSettings() {
        return new Promise(resolve => {
            const cancel = Utilities.monkeyPatch(WebpackModules.getByProps("getUserSettingsSections").default.prototype, "render", {after: (data) => {
                resolve(data.returnValue.type);
                data.thisObject.forceUpdate();
                cancel();
            }});
        });
    }

    saveSettings() {
        DataStore.setData("settings", this.state);
    }

    loadSettings() {
        const previousState = DataStore.getData("settings");
        if (!previousState) return this.saveSettings();
        for (const collection in this.state) {
            if (!previousState[collection]) Object.assign(previousState, {[collection]: this.state[collection]});
            for (const category in this.state[collection]) {
                if (!previousState[collection][category]) Object.assign(previousState[collection][category], {[category]: this.state[collection][category]});
                for (const setting in this.state[collection][category]) {
                    if (previousState[collection][category][setting] == undefined) continue;
                    this.state[collection][category][setting] = previousState[collection][category][setting];
                }
            }
        }

        this.saveSettings(); // in case new things were added
    }

    onSettingChange(collection, category, id, value) {
        const before = this.collections.length;
        this.state[collection][category][id] = value;
        Events.dispatch("setting-updated", collection, category, id, value);
        const after = this.collections.length;
        this.saveSettings();
        if (before != after) this.forceUpdate();
    }

    getSetting(collection, category, id) {
        if (arguments.length == 2) return this.collections[0].find(c => c.id == arguments[0]).settings.find(s => s.id == arguments[1]);
        return this.collections.find(c => c.id == collection).find(c => c.id == category).settings.find(s => s.id == id);
    }

    get(collection, category, id) {
        if (arguments.length == 2) {
            id = category;
            category = collection;
            collection = "settings";
        }
        if (!this.state[collection] || !this.state[collection][category]) return false;
        return this.state[collection][category][id];
    }

    on(collection, category, identifier, callback) {
        const handler = (col, cat, id, value) => {
            if (col !== collection || cat !== category || id !== identifier) return;
            callback(value);
        };
        Events.on("setting-updated", handler);
        return () => {Events.off("setting-updated", handler);};
    }

    updateSettings(collection, category, id, enabled) {

        if (id == "fork-wp-1") {
            BdApi.setWindowPreference("transparent", enabled);
            if (enabled) BdApi.setWindowPreference("backgroundColor", null);
            else BdApi.setWindowPreference("backgroundColor", "#2f3136");
        }

        // this.saveSettings();
    }
};