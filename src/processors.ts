import { MarkdownPostProcessorContext } from 'obsidian';
import * as tmp from 'tmp';
import * as fs from 'fs';
import { spawn } from 'child_process';
import GraphvizPlugin from './main';
import { ProcessingMode } from './setting';

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
      const outputFormat = this.plugin.settings.localDotOutputFormat;
      const parameters = [ `-T${outputFormat}`, `-Gbgcolor=transparent`, `-Gstylesheet=obs-gviz.css`, sourceFile ];

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
          reject(`"${cmdPath} ${parameters.join(' ')}" failed, error code: ${code}, stderr: ${errData}`);
        } else {
          resolve(Buffer.concat(outData));
        }
      });
      dotProcess.on('error', function (err: Error) {
        reject(`"${cmdPath} ${parameters.join(' ')}" failed, ${err}`);
      });
    });
  }

  private async convertToImage(dotSource: string): Promise<Uint8Array> {
    const self = this;
    return new Promise<Uint8Array>((resolve, reject) => {
      tmp.file(function (err, tmpPath, fd, cleanupCallback) {
        if (err) {
          cleanupCallback();
          return reject(err);
        }

        fs.write(fd, dotSource, function (err) {
          if (err) {
            fs.close(fd, () => {
              cleanupCallback();
              reject(`write to ${tmpPath} error ${err}`);
            });
            return;
          }
          fs.close(fd,
            function (err) {
              if (err) {
                cleanupCallback();
                return reject(`close ${tmpPath} error ${err}`);
              }
              self.writeDotFile(tmpPath)
                  .then(data => {
                      cleanupCallback();
                      resolve(data);
                  })
                  .catch(message => {
                      cleanupCallback();
                      reject(message);
                  });
            }
          );
        });
      });
    });
  }

  public async imageProcessor(source: string, el: HTMLElement, _: MarkdownPostProcessorContext): Promise<void> {
    const stringBeforeBrace = source.split("{", 1)[0]?.trim() || "";
    const wordsBeforeBrace = stringBeforeBrace.split(/\s+/);
    const processingMode = this.plugin.settings.processingMode;

    try {
      console.debug(`Call image processor (mode: ${processingMode})`);

      if (processingMode === 'svg') {
        console.debug('Requesting SVG from LLM');
        const responseBody = await this.callOpenAI(source, 'svg');

        const svgCode = responseBody.svg_code || responseBody.svg;
        if (svgCode) {
          console.debug('Rendering SVG directly from LLM');
          const div = document.createElement('div');
          div.setAttribute("class", "graphviz-svg-container " + wordsBeforeBrace.join(" "));
          div.innerHTML = svgCode;
          const svgElement = div.querySelector('svg');
          if (svgElement) {
            svgElement.classList.add("graphviz");
          }
          el.appendChild(div);
        } else {
          throw new Error(responseBody.error_message || 'LLM failed to generate SVG code (checked keys: svg_code, svg).');
        }

      } else if (processingMode === 'dot') {
        console.debug('Requesting DOT from LLM');
        const responseBody = await this.callOpenAI(source, 'dot');

        const dotCode = responseBody.dot_code || responseBody.dot;
        if (dotCode) {
          console.debug('Rendering DOT from LLM using local Graphviz');
          await this.renderDotLocally(dotCode, el, wordsBeforeBrace);
        } else {
          throw new Error(responseBody.error_message || 'LLM failed to generate DOT code (checked keys: dot_code, dot).');
        }

      } else {
        throw new Error(`Unknown processing mode: ${processingMode}`);
      }

    } catch (errMessage) {
      console.error('Error processing graph:', errMessage);
      const pre = document.createElement('pre');
      pre.classList.add("graphviz-error");
      const code = document.createElement('code');
      pre.appendChild(code);
      code.setText(errMessage instanceof Error ? errMessage.message : String(errMessage));
      el.appendChild(pre);
    }
  }
  
  private async callOpenAI(
      source: string,
      targetFormat: 'dot' | 'svg'
    ): Promise<{dot_code?: string, svg_code?: string, dot?: string, svg?: string, error_message?: string, sometext?: string}> {
    const apiKey = this.plugin.settings.apiKey;
    if (!apiKey) {
        throw new Error("OpenAI API Key is not configured in settings.");
    }

    let schema: any;
    let promptContent: string;

    if (targetFormat === 'svg') {
        promptContent = `Please generate an SVG image based on the following description. Respond ONLY in the specified JSON format. The SVG code must be self-contained and renderable. Description: ${source}`;
        schema = {
            "type": "object",
            "properties": {
              "svg_code": {
                "type": "string",
                "description": "Self-contained SVG code representing the graph. It should render correctly when embedded in HTML."
              },
              "error_message": {
                "type": "string",
                "description": "Error message if SVG generation failed or is not possible from the description."
              },
              "sometext": {
                "type": "string",
                "description": "Any additional text or comments, ONLY if necessary."
              }
            },
            "required": [],
            "additionalProperties": false
        };
    } else {
        promptContent = `Please generate Graphviz DOT language code based on the following description. Respond ONLY in the specified JSON format. The DOT code must be valid and renderable by Graphviz. Description: ${source}`;
        schema = {
            "type": "object",
            "properties": {
                "dot_code": {
                    "type": "string",
                    "description": "DOT format graph definition code. Only the DOT code, suitable for direct input to Graphviz."
                },
                "error_message": {
                    "type": "string",
                    "description": "Error message if DOT generation failed or is not possible from the description."
                },
                "sometext": {
                    "type": "string",
                    "description": "Any additional text or comments, ONLY if necessary."
                }
            },
            "required": [],
            "additionalProperties": false
        };
    }


    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          "model": this.plugin.settings.model,
          "messages": [{ role: 'user', content: promptContent }],
          "response_format": {
            "type": "json_object",
          },
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAI API request failed. Status:', response.status, 'Response:', errorText);
        throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const jsonResponse = await response.json();

      console.debug('Raw OpenAI Response:', JSON.stringify(jsonResponse, null, 2));

      if (!jsonResponse.choices || jsonResponse.choices.length === 0 || !jsonResponse.choices[0].message || !jsonResponse.choices[0].message.content) {
        console.error('Invalid response structure received:', jsonResponse);
        throw new Error('Invalid response structure from OpenAI API.');
      }

      const rawContent = jsonResponse.choices[0].message.content;
      console.debug('Raw LLM content string:', rawContent);

      let parsedResponseBody: any;
      try {
          parsedResponseBody = JSON.parse(rawContent);
      } catch (parseError) {
          console.error('Failed to parse LLM response JSON. Raw content:', rawContent, 'Error:', parseError);
          throw new Error(`Failed to parse LLM response JSON: ${parseError}. Response: ${rawContent}`);
      }

      const responseBody: {dot_code?: string, svg_code?: string, dot?: string, svg?: string, error_message?: string, sometext?: string} = parsedResponseBody;

      console.debug('Parsed OpenAI Response Body:', responseBody);

      if (responseBody.error_message) {
          console.warn(`LLM reported an issue: ${responseBody.error_message}`);
      }

      const requiredCodeFieldWithSuffix = targetFormat === 'svg' ? 'svg_code' : 'dot_code';
      const requiredCodeFieldWithoutSuffix = targetFormat;

      console.debug(`Checking for fields: '${requiredCodeFieldWithSuffix}' or '${requiredCodeFieldWithoutSuffix}' or 'error_message'. Received keys:`, Object.keys(responseBody));

      if (!(responseBody[requiredCodeFieldWithSuffix] || responseBody[requiredCodeFieldWithoutSuffix] || responseBody.error_message)) {
          const receivedKeys = Object.keys(responseBody).join(', ') || 'none';
          const checkedKeys = `'${requiredCodeFieldWithSuffix}', '${requiredCodeFieldWithoutSuffix}', 'error_message'`;
          console.error(`LLM response missing required fields. Checked: ${checkedKeys}. Received keys: ${receivedKeys}. Raw content: ${rawContent}`);
          throw new Error(`LLM response is missing any of the expected fields (${checkedKeys}). Received keys: [${receivedKeys}]`);
      }

      return responseBody;

    } catch (error) {
      console.error("Error calling OpenAI API or processing response:", error);
      throw error;
    }
  }

  private async renderDotLocally(dotSource: string, el: HTMLElement, cssClasses: string[]): Promise<void> {
      const imageData = await this.convertToImage(dotSource);
      const outputFormat = this.plugin.settings.localDotOutputFormat;
      const mimeType = this.imageMimeType.get(outputFormat) || 'application/octet-stream';

      if (outputFormat === 'svg') {
          const svgString = new TextDecoder().decode(imageData);
          const div = document.createElement('div');
          div.setAttribute("class", "graphviz-svg-container " + cssClasses.join(" "));
          div.innerHTML = svgString;
          const svgElement = div.querySelector('svg');
          if (svgElement) {
              svgElement.classList.add("graphviz");
              svgElement.style.maxWidth = '100%';
              svgElement.style.height = 'auto';
          }
          el.appendChild(div);
      } else {
          const blob = new Blob([ imageData ], {'type': mimeType});
          const url = window.URL || window.webkitURL;
          const blobUrl = url.createObjectURL(blob);
          const img = document.createElement('img');
          img.setAttribute("class", "graphviz " + cssClasses.join(" "));
          img.setAttribute("src", blobUrl);
          el.appendChild(img);
      }
  }
}
