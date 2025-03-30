import { MarkdownPostProcessorContext } from 'obsidian';
import * as tmp from 'tmp';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import GraphvizPlugin from './main';

export class Processors {
  plugin: GraphvizPlugin;

  constructor(plugin: GraphvizPlugin) {
    this.plugin = plugin;
  }
  
  imageMimeType = new Map<string, string>([
        ['png', 'image/png'],
        ['svg', 'image/svg+xml']
    ]);

  private async writeDotFile(sourceFile: string): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const cmdPath = this.plugin.settings.dotPath;
      const imageFormat = this.plugin.settings.imageFormat;
      const parameters = [ `-T${imageFormat}`, `-Gbgcolor=transparent`, `-Gstylesheet=obs-gviz.css`, sourceFile ];

      console.debug(`Starting dot process ${cmdPath}, ${parameters}`);
      const dotProcess = spawn(cmdPath, parameters);
      const outData: Array<Uint8Array> = [];
      let errData = '';

      dotProcess.stdout.on('data', function (data) {
        outData.push(data);
      });
      dotProcess.stderr.on('data', function (data) {
        errData += data;
      });
      dotProcess.stdin.end();
      dotProcess.on('exit', function (code) {
        if (code !== 0) {
          reject(`"${cmdPath} ${parameters}" failed, error code: ${code}, stderr: ${errData}`);
        } else {
          resolve(Buffer.concat(outData));
        }
      });
      dotProcess.on('error', function (err: Error) {
        reject(`"${cmdPath} ${parameters}" failed, ${err}`);
      });
    });
  }

  private async convertToImage(source: string): Promise<Uint8Array> {
    const self = this;
    return new Promise<Uint8Array>((resolve, reject) => {
      tmp.file(function (err, tmpPath, fd, _/* cleanupCallback */) {
        if (err) reject(err);

        fs.write(fd, source, function (err) {
          if (err) {
            reject(`write to ${tmpPath} error ${err}`);
            return;
          }
          fs.close(fd,
            function (err) {
              if (err) {
                reject(`close ${tmpPath} error ${err}`);
                return;
              }
              return self.writeDotFile(tmpPath).then(data => resolve(data)).catch(message => reject(message));
            }
          );
        });
      });
    });
  }

  public async imageProcessor(source: string, el: HTMLElement, _: MarkdownPostProcessorContext): Promise<void> {
    const stringBeforeBrace = source.split("{", 1)[0]?.trim() || "";
    const wordsBeforeBrace = stringBeforeBrace.split();
    const imageFormat = this.plugin.settings.imageFormat;

    try {
      console.debug('Call image processor (format: ' + imageFormat + ')');
      //make sure url is defined. once the setting gets reset to default, an empty string will be returned by settings
      const responseBody = await this.callOpenAI(source);

      if (imageFormat === 'svg') {
        // SVGモードの場合
        if (responseBody.svg_code) {
          console.debug('Rendering SVG directly');
          const div = document.createElement('div');
          div.setAttribute("class", "graphviz-svg-container " + wordsBeforeBrace.join(" "));
          // LLMが生成したSVGを直接挿入
          // 注意: サニタイズが必要な場合がありますが、Obsidianのコンテキストでは
          // 通常ユーザー自身の入力に基づいているため、ここでは直接設定します。
          div.innerHTML = responseBody.svg_code;
          // SVG要素自体にクラスを追加してCSSで制御しやすくする
          const svgElement = div.querySelector('svg');
          if (svgElement) {
            svgElement.classList.add("graphviz");
            // SVGのサイズ調整などが必要な場合はここで行う
            // svgElement.style.maxWidth = '100%';
            // svgElement.style.height = 'auto';
          }
          el.appendChild(div);
        } else if (responseBody.error_message) {
            throw new Error(`SVG generation failed: ${responseBody.error_message}`);
        } else {
            throw new Error('SVG code is empty in the response.');
        }

      } else {
        // PNG (または他の画像) モードの場合 (従来の処理)
        console.debug("その他", responseBody["sometext"], responseBody)
        if (responseBody.dot_code) {
            const imageData = await this.convertToImage(responseBody.dot_code);
            const blob = new Blob([ imageData ], {'type': this.imageMimeType.get(imageFormat)});
            const url = window.URL || window.webkitURL;
            const blobUrl = url.createObjectURL(blob);
            const img = document.createElement('img');
            img.setAttribute("class", "graphviz " + wordsBeforeBrace.join(" "));
            img.setAttribute("src", blobUrl);
            el.appendChild(img);
        } else if (responseBody.error_message) {
            throw new Error(`DOT generation failed: ${responseBody.error_message}`);
        } else {
            throw new Error('DOT code is empty in the response.');
        }
      }

    } catch (errMessage) {
      console.error('Error processing graph:', errMessage);
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      pre.appendChild(code);
      code.setText(errMessage instanceof Error ? errMessage.message : String(errMessage)); // エラーメッセージを適切に表示
      el.appendChild(pre);
    }
  }
  
  private async callOpenAI(source: string): Promise<{dot_code?: string, svg_code?: string, error_message?: string, sometext?: string}> {
    const apiKey = this.plugin.settings.apiKey;
    const imageFormat = this.plugin.settings.imageFormat;
    // レスポンスボディの初期化を修正
    let responseBody: {dot_code?: string, svg_code?: string, error_message?: string, sometext?: string} = {};

    // スキーマとプロンプトを動的に決定
    let schema: any;
    let promptContent: string;
    const requiredFields: string[] = ["error_message", "sometext"];

    if (imageFormat === 'svg') {
        // SVGモードのスキーマとプロンプト
        promptContent = `Please generate an SVG image based on the following description. Respond in JSON format according to the provided schema. SVG code should be self-contained and renderable. Description: ${source}`;
        schema = {
            "type": "object",
            "properties": {
              "svg_code": {
                "type": "string",
                "description": "Self-contained SVG code representing the graph. It should render correctly when embedded in HTML."
              },
              "error_message": {
                "type": "string",
                "description": "Error message if SVG generation failed."
              },
              "sometext": {
                "type": "string",
                "description": "Any additional text or comments, not part of the SVG code."
              }
            },
            "required": ["svg_code", ...requiredFields], // svg_code を必須にする
            "additionalProperties": false
        };
    } else {
        // DOTモードのスキーマとプロンプト (従来通り)
        promptContent = `Please generate DOT language code based on the following description. Respond in JSON format according to the provided schema. DOT code should be valid and renderable by Graphviz. Description: ${source}`;
        schema = {
            "type": "object",
            "properties": {
                "dot_code": {
                    "type": "string",
                    "description": "DOT format graph definition code. Only the DOT code, suitable for direct input to Graphviz."
                },
                "error_message": {
                    "type": "string",
                    "description": "Error message if DOT generation failed."
                },
                "sometext": {
                    "type": "string",
                    "description": "Any additional text or comments, not part of the DOT code."
                }
            },
            "required": ["dot_code", ...requiredFields], // dot_code を必須にする
            "additionalProperties": false
        };
    }


    try {
      // 以下は実際のAPIリクエストを行う場合のコード例（APIキーが必要）
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          "model": this.plugin.settings.model,
          "messages": [{ role: 'user', content: promptContent }], // プロンプトを適用
          "response_format": {
            "type": "json_schema",
            "json_schema": {
              // スキーマ名を動的に変更 (必須ではないが一応)
              "name": imageFormat === 'svg' ? "svg_response" : "dot_language_response",
              "strict": true,
              "schema": schema // 決定したスキーマを適用
            }
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const jsonResponse = await response.json();

      // APIレスポンスから必要なデータを抽出
      // choiceが空、またはmessageがない、またはcontentがない場合のエラーハンドリングを追加
      if (!jsonResponse.choices || jsonResponse.choices.length === 0 || !jsonResponse.choices[0].message || !jsonResponse.choices[0].message.content) {
        throw new Error('Invalid response structure from OpenAI API.');
      }
      // JSON文字列をパースしてresponseBodyに格納
      responseBody = JSON.parse(jsonResponse.choices[0].message.content);


      console.debug('OpenAI Response:', responseBody);

      // エラーメッセージがあるかチェック (オプショナルだが、ある場合は早期にエラーとする)
      if (responseBody.error_message) {
          console.warn(`LLM reported an error: ${responseBody.error_message}`);
          // SVG/DOTコードがなくてもエラーメッセージがあればそれを優先してエラーとするか、
          // あるいは単に警告としてログに残すかは要件による。ここでは警告ログのみ。
      }

      // 必須フィールドの存在チェック (スキーマで required を指定していても、念のため)
      const requiredCodeField = imageFormat === 'svg' ? 'svg_code' : 'dot_code';
      if (!(requiredCodeField in responseBody)) {
          // error_message があればそれを使い、なければ汎用的なエラーを投げる
          throw new Error(responseBody.error_message || `Required field '${requiredCodeField}' is missing in the response.`);
      }


    } catch (error) {
      console.error("Error calling OpenAI API or processing response:", error);
      // エラー情報を responseBody に格納して返すか、ここで例外を再スローするか選択
      // ここでは再スローし、呼び出し元の imageProcessor でキャッチする
      throw error; // エラーを imageProcessor に伝播させる
    }

    return responseBody;
  }

  public async fetchModels(): Promise<string[]> {
    const apiKey = this.plugin.settings.apiKey;
    // Default models in case API call fails
    const defaultModels = ["gpt-4o-mini", "gpt-4", "gpt-3.5-turbo"];
    
    try {
      // Only fetch if API key is provided
      if (!apiKey) {
        console.debug('No API key provided, using default models');
        return defaultModels;
      }
      
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        // Filter models suitable for chat completions (those containing 'gpt')
        return data.data
          .filter((model: any) => model.id.includes('gpt'))
          .map((model: any) => model.id);
      }
    } catch (error) {
      console.error('Error fetching OpenAI models:', error);
    }
    
    return defaultModels;
  }
}
