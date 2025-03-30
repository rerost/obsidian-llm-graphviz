import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, GraphvizSettings, GraphvizSettingsTab, ProcessingMode } from './setting';
import { Processors } from './processors';
// Suggesters は現在使われていないためコメントアウトまたは削除しても良いかもしれません
// import { Suggesters } from './suggesters';

// Remember to rename these classes and interfaces!


export default class GraphvizPlugin extends Plugin {
  settings: GraphvizSettings;

  async onload() {
    console.debug('Load graphviz plugin');
    await this.loadSettings();
    this.addSettingTab(new GraphvizSettingsTab(this.app, this));
    const processors = new Processors(this);

    this.app.workspace.onLayoutReady(() => {
      this.registerMarkdownCodeBlockProcessor('prompt-dot', processors.imageProcessor.bind(processors));
      // Suggesters を使う場合はコメントを解除
      // this.registerEditorSuggest(new Suggesters(this.app, this));
    });
  }



  onunload() {
    console.debug('Unload graphviz plugin');
  }

  async loadSettings(): Promise<void> {
    const loadedData = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

    const validModes: ProcessingMode[] = ['dot', 'svg'];
    if (!validModes.includes(this.settings.processingMode)) {
      console.warn(`Invalid processingMode loaded: '${this.settings.processingMode}'. Falling back to default: '${DEFAULT_SETTINGS.processingMode}'`);
      this.settings.processingMode = DEFAULT_SETTINGS.processingMode;
      await this.saveSettings();
    }
  }


  async saveSettings() {
    await this.saveData(this.settings);
  }
}
