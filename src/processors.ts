import { MarkdownPostProcessorContext } from 'obsidian';
import * as tmp from 'tmp';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import GraphvizPlugin from './main';
// import {graphviz} from 'd3-graphviz'; => does not work, ideas how to embed d3 into the plugin?

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

    try {
      console.debug('Call image processor');
      //make sure url is defined. once the setting gets reset to default, an empty string will be returned by settings
      const responseBody = await this.callOpenAI(source);
      console.debug("その他", responseBody["sometext"], responseBody)
      const imageData = await this.convertToImage(responseBody.dot_code);
      const blob = new Blob([ imageData ], {'type': this.imageMimeType.get(this.plugin.settings.imageFormat)});
      const url = window.URL || window.webkitURL;
      const blobUrl = url.createObjectURL(blob);
      const img = document.createElement('img');
      img.setAttribute("class", "graphviz " + wordsBeforeBrace.join(" "));
      img.setAttribute("src", blobUrl);
      el.appendChild(img);
    } catch (errMessage) {
      console.error('convert to image error', errMessage);
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      pre.appendChild(code);
      code.setText(errMessage);
      el.appendChild(pre);
    }
  }
  
  public async d3graphvizProcessor(source: string, el: HTMLElement, _: MarkdownPostProcessorContext): Promise<void> {
    console.debug('Call d3graphvizProcessor');

    const responseBody = await this.callOpenAI(source);
    // 以下は既存のグラフ処理コード
    const stringBeforeBrace = source.split("{", 1)[0]?.trim() || "";
    const wordsBeforeBrace = stringBeforeBrace.split();

    const div = document.createElement('div');
    const graphId = 'd3graph_' + createHash('md5').update(source).digest('hex').substring(0, 6);
    div.setAttr('id', graphId);
    div.setAttr('style', 'text-align: center');
    div.setAttr('class', 'graphviz ' + wordsBeforeBrace.join(" "));
    el.appendChild(div);
    const script = document.createElement('script');
    // graphviz(graphId).renderDot(source); => does not work, ideas how to use it?
    // Besides, sometimes d3 is undefined, so there must be a proper way to integrate d3.
    console.log("その他", responseBody["sometext"], responseBody)
    const escapedSource = responseBody["dot_code"].replaceAll('\\', '\\\\').replaceAll('`','\\`');
    script.text =
      `if( typeof d3 != 'undefined') { 
        d3.select("#${graphId}").graphviz()
        .onerror(d3error)
       .renderDot(\`${escapedSource}\`);
    }
    console.log(d3)
    function d3error (err) {
        d3.select("#${graphId}").html(\`<div class="d3graphvizError"> d3.graphviz(): \`+err.toString()+\`</div>\`);
        console.error('Caught error on ${graphId}: ', err);
    }`;
    el.appendChild(script);
  }

  private async callOpenAI(source: string): Promise<{dot_code: string, error_message: string, sometext: string}> {
    const apiKey = this.plugin.settings.apiKey
    let responseBody = {
      "dot_code": "",
      "error_message": "",
      "sometext": ""
    };

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
          "messages": [{ role: 'user', content: source }],
          "response_format": {
            "type": "json_schema",
            "json_schema": {
              "name": "dot_language_response",
              "strict": true,
              "schema": {
                "type": "object",
                "properties": {
                  "dot_code": {
                    "type": "string",
                    "description": "DOT形式のグラフ定義コード。コードブロックでdotのみ、そのまま渡してもエラーにならない"
                  },
                  "error_message": {
                    "type": "string",
                    "description": "エラーが発生した場合のエラーメッセージ"
                  },
                  "sometext": {
                    "type": "string",
                    "description": "dot以外の記述があればこちら"
                  }
                },
                "required": [
                  "dot_code",
                  "error_message",
                  "sometext"
                ],
                "additionalProperties": false
              }
            }
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        responseBody = JSON.parse(data.choices[0].message.content);
      }
    } catch (error) {
      console.error('ChatGPTへの問い合わせでエラーが発生しました:', error);
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
