import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, GraphvizSettings, GraphvizSettingsTab } from './setting';
import { Processors } from './processors';
import { Suggesters } from './suggesters';

// Remember to rename these classes and interfaces!


export default class GraphvizPlugin extends Plugin {
  settings: GraphvizSettings;

  async onload() {
    console.debug('Load graphviz plugin');
    await this.loadSettings();
    this.addSettingTab(new GraphvizSettingsTab(this));
    const processors = new Processors(this);

    this.app.workspace.onLayoutReady(() => {
      this.registerMarkdownCodeBlockProcessor('prompt-dot', processors.imageProcessor.bind(processors));
    });
  }



  onunload() {
    console.debug('Unload graphviz plugin');
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    return Promise.resolve();
  }


  async saveSettings() {
    await this.saveData(this.settings);
  }
}
