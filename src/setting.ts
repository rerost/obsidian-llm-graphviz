import { PluginSettingTab, Setting } from 'obsidian';
import GraphvizPlugin from './main';
// import { Processors } from './processors'; // Processors はここでは不要

// 処理モードの型定義を更新 ('dot' と 'svg' のみに)
export type ProcessingMode = 'dot' | 'svg'; // 'local-dot' を削除

export interface GraphvizSettings {
  // renderer: string; // 以前の設定項目 (削除または移行)
  processingMode: ProcessingMode; // 'dot' | 'svg'
  dotPath: string;
  localDotOutputFormat: string; // 'dot' モードでローカル描画する際の形式
  apiKey: string;
  model: string;
}

export const DEFAULT_SETTINGS: GraphvizSettings = {
  // renderer: 'dot', // 以前のデフォルト (削除または移行)
  processingMode: 'dot', // デフォルトを 'dot' (旧 llm-dot-local) に変更
  dotPath: 'dot',
  localDotOutputFormat: 'png',
  apiKey: '',
  model: 'gpt-4o-mini'
};

export class GraphvizSettingsTab extends PluginSettingTab {
  plugin: GraphvizPlugin;

  // 設定項目要素を保持するためのプロパティ
  private dotPathSetting: Setting;
  private localDotOutputFormatSetting: Setting;
  private apiKeySetting: Setting;
  private modelSetting: Setting;
  // private rendererSetting: Setting; // 以前の設定項目 (削除または移行)

  constructor(app: any, plugin: GraphvizPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const {containerEl} = this;
    containerEl.empty();

    containerEl.createEl('h2', {text: 'Obsidian LLM Graphviz Settings'});

    // 処理モード選択を更新
    new Setting(containerEl)
      .setName('Processing mode')
      .setDesc('Choose how to process the prompt-dot block using LLM.')
      .addDropdown(dropdown => dropdown
        // 'local-dot' オプションを削除
        .addOption('dot', 'DOT (Render dot image)') // キーを 'dot'、表示名を更新
        .addOption('svg', 'SVG (Render svg image)') // キーを 'svg'、表示名を更新
        .setValue(this.plugin.settings.processingMode)
        .onChange(async (value: ProcessingMode) => {
          this.plugin.settings.processingMode = value;
          await this.plugin.saveSettings();
          this.updateSettingsVisibility();
        }));

    // --- Dot Path (常に表示) ---
    this.dotPathSetting = new Setting(containerEl)
      .setName('Dot Path')
      // 説明を更新：'DOT' モードでのみ使用されることを明確化
      .setDesc('Path to the local dot executable (used only in "DOT" mode).')
      .addText(text => text.setPlaceholder(DEFAULT_SETTINGS.dotPath)
        .setValue(this.plugin.settings.dotPath)
        .onChange(async (value) => {
          this.plugin.settings.dotPath = value;
          await this.plugin.saveSettings();
        }));

    // --- Local Dot Output Format ('dot' モードでのみ表示) ---
    this.localDotOutputFormatSetting = new Setting(containerEl)
      .setName('Local Dot Output Format')
      .setDesc('Output format (png or svg) when using the local dot executable in "DOT" mode.')
      .addDropdown(dropdown => dropdown
        .addOption('png', 'png')
        .addOption('svg', 'svg')
        .setValue(this.plugin.settings.localDotOutputFormat)
        .onChange(async (value) => {
          this.plugin.settings.localDotOutputFormat = value;
          await this.plugin.saveSettings();
        }));

    // --- LLM関連設定 (両方のモードで表示) ---
    this.apiKeySetting = new Setting(containerEl)
      .setName('OpenAI API Key')
      .setDesc('Your OpenAI API Key (required for both DOT and SVG modes).')
      .addText(text => text.setPlaceholder('sk-...')
        .setValue(this.plugin.settings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.apiKey = value;
          await this.plugin.saveSettings();
        }));

    this.modelSetting = new Setting(containerEl)
      .setName('OpenAI Model')
      .setDesc('The OpenAI model to use for generation (e.g., gpt-4o-mini, gpt-4).')
      .addText(text => text.setPlaceholder(DEFAULT_SETTINGS.model)
        .setValue(this.plugin.settings.model)
        .onChange(async (value) => {
          this.plugin.settings.model = value;
          await this.plugin.saveSettings();
        }));
        // TODO: 可能であればモデルリストをフェッチしてドロップダウンにする改善

    // 初期表示状態を設定
    this.updateSettingsVisibility();
  }

  // 設定項目の表示/非表示を更新するメソッド
  private updateSettingsVisibility(): void {
    const mode = this.plugin.settings.processingMode;

    // 'dot' モードの場合のみ Local Dot Output Format を表示
    const showLocalDotOutputFormat = mode === 'dot';
    // LLM設定は両方のモードで必要
    // const showLLMSettings = mode === 'dot' || mode === 'svg'; // 常に true なので不要

    // Local Dot Output Format の表示制御
    if (this.localDotOutputFormatSetting) {
        this.localDotOutputFormatSetting.settingEl.style.display = showLocalDotOutputFormat ? '' : 'none';
    }
    // API Key と Model は常に表示 (LLMが必須のため)
    if (this.apiKeySetting) {
        this.apiKeySetting.settingEl.style.display = ''; // 常に表示
    }
    if (this.modelSetting) {
        this.modelSetting.settingEl.style.display = ''; // 常に表示
    }
    // Dot Path も常に表示される（変更なし）
  }
}
