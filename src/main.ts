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

  public async fetchModels(): Promise<string[]> {
    const apiKey = this.settings.apiKey;
    const defaultModels = ["gpt-4o-mini", "gpt-4", "gpt-3.5-turbo"];

    try {
      if (!apiKey) {
        console.debug('No API key provided, using default models for dropdown.');
        return [...defaultModels, this.settings.model]
               .filter((v, i, a) => a.indexOf(v) === i)
               .sort();
      }

      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        const fetchedModels = data.data
          .filter((model: any) => model.id.includes('gpt'))
          .map((model: any) => model.id) as string[];

        return [...fetchedModels, this.settings.model, ...defaultModels]
               .filter((v, i, a) => a.indexOf(v) === i)
               .sort();
      } else {
          console.error(`Error fetching models: ${response.status} ${response.statusText}`, await response.text());
          return [...defaultModels, this.settings.model]
                 .filter((v, i, a) => a.indexOf(v) === i)
                 .sort();
      }
    } catch (error) {
      console.error('Error fetching OpenAI models:', error);
      return [...defaultModels, this.settings.model]
             .filter((v, i, a) => a.indexOf(v) === i)
             .sort();
    }
  }
}
