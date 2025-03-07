import * as fs from 'fs-extra';
import * as path from 'path';
import { chromium } from 'playwright';
import { EventType, eventWithTime } from '@rrweb/types';
import type Player from 'rrweb-player';

// The max valid scale value for the scaling method which can improve the video quality.
const MaxScaleValue = 1;

type RRvideoConfig = {
  input: string;
  output?: string;
  headless?: boolean;
  // A number between 0 and 1. The higher the value, the better the quality of the video.
  resolutionRatio?: number;
  // A callback function that will be called when the progress of the replay is updated.
  onProgressUpdate?: (percent: number) => void;
  rrwebPlayer?: Omit<
    ConstructorParameters<typeof Player>[0]['props'],
    'events'
  >;
};

const defaultConfig: Required<RRvideoConfig> = {
  input: '',
  output: 'rrvideo-output.webm',
  headless: false,
  // A good trade-off value between quality and file size.
  resolutionRatio: 0.8,
  onProgressUpdate: () => {
    //
  },
  rrwebPlayer: {},
};

function getHtml(events: Array<eventWithTime>, config?: RRvideoConfig): string {
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>rrweb Player</title>
    <!-- Add rrweb-player CSS from CDN -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/rrweb-player@latest/dist/style.css" />
    <style>
      html, body {
        padding: 0;
        border: none;
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        box-sizing: border-box;
      }
      
      /* Container that fits the content exactly */
      .player-container {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: visible;
        padding: 0;
        margin: 0;
      }
      
      /* Player wrapper with explicit dimensions */
      #player-wrapper {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: visible;
        padding: 0;
        margin: 0;
      }
      
      /* Base player styles */
      .rr-player {
        width: 100% !important;
        height: 100% !important;
        overflow: visible !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      
      .rr-player__frame {
        width: 100% !important;
        height: 100% !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      
      .replayer-wrapper {
        overflow: visible !important;
      }
      
      .replayer-mouse-tail {
        position: absolute;
        pointer-events: none;
      }
      
      /* Controller styles */
      .rr-controller {
        border: none !important;
        bottom: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
      }
    </style>
    
    <!-- Define events data -->
    <script>
      const events = ${JSON.stringify(events).replace(
        /<\/script>/g,
        '<\\/script>',
      )};
    </script>
    
    <!-- Add rrweb-player JS from CDN -->
    <script src="https://cdn.jsdelivr.net/npm/rrweb-player@latest/dist/index.js"></script>
  </head>
  <body>
    <div class="player-container">
      <div id="player-wrapper"></div>
    </div>
  </body>
  
  <script>
    document.addEventListener('DOMContentLoaded', () => {
      const userConfig = ${JSON.stringify(config?.rrwebPlayer || {})};
      const wrapper = document.getElementById('player-wrapper');
      
      // Create the rrweb player instance
      window.replayer = new rrwebPlayer({
        target: wrapper,
        props: {
          events,
          showController: true,
          skipInactive: false,
          autoPlay: true,
          mouseTail: {
            strokeStyle: 'yellow',
          },
          ...userConfig,
        },
      });
      
      console.log('Player configured with dimensions:', userConfig.width, 'x', userConfig.height);
      
      // Add event listeners
      window.replayer.addEventListener('ui-update-progress', (payload) => {
        if (typeof window.onReplayProgressUpdate === 'function') {
          window.onReplayProgressUpdate(payload);
        }
      });
      
      window.replayer.addEventListener('finish', () => {
        if (typeof window.onReplayFinish === 'function') {
          window.onReplayFinish();
        }
      });
    });
  </script>
</html>
`;
}

/**
 * Preprocess all events to get a maximum view port size.
 */
function getMaxViewport(events: eventWithTime[]) {
  let maxWidth = 500,
    maxHeight = 500;
  events.forEach((event) => {
    if (event.type !== EventType.Meta) return;
    if (event.data.width > maxWidth) maxWidth = event.data.width;
    if (event.data.height > maxHeight) maxHeight = event.data.height;
  });
  return {
    width: maxWidth,
    height: maxHeight,
  };
}

export async function transformToVideo(options: RRvideoConfig) {
  const defaultVideoDir = '__rrvideo__temp__';
  const config = { ...defaultConfig };
  if (!options.input) throw new Error('input is required');
  // If the output is not specified or undefined, use the default value.
  if (!options.output) delete options.output;
  Object.assign(config, options);
  if (config.resolutionRatio > 1) config.resolutionRatio = 1; // The max value is 1.

  const eventsPath = path.isAbsolute(config.input)
    ? config.input
    : path.resolve(process.cwd(), config.input);
  const outputPath = path.isAbsolute(config.output)
    ? config.output
    : path.resolve(process.cwd(), config.output);
  const events = JSON.parse(
    fs.readFileSync(eventsPath, 'utf-8'),
  ) as eventWithTime[];

  // Get the exact viewport from events
  const maxViewport = getMaxViewport(events);
  
  // Apply resolution ratio to control quality
  const scaledViewport = {
    width: Math.round(maxViewport.width * (config.resolutionRatio ?? 1)),
    height: Math.round(maxViewport.height * (config.resolutionRatio ?? 1)),
  };
  
  // Use the same dimensions for both player and viewport
  Object.assign(config.rrwebPlayer, scaledViewport);
  
  console.log('Using viewport dimensions:', scaledViewport);
  
  const browser = await chromium.launch({
    headless: config.headless,
  });
  const context = await browser.newContext({
    viewport: scaledViewport,
    recordVideo: {
      dir: defaultVideoDir,
      size: scaledViewport,
    },
  });
  const page = await context.newPage();
  await page.goto('about:blank');
  await page.exposeFunction(
    'onReplayProgressUpdate',
    (data: { payload: number }) => {
      config.onProgressUpdate(data.payload);
    },
  );
  // Wait for the replay to finish
  await new Promise<void>(
    (resolve) =>
      void page
        .exposeFunction('onReplayFinish', () => resolve())
        .then(() => page.setContent(getHtml(events, config))),
  );
  const videoPath = (await page.video()?.path()) || '';
  const cleanFiles = async (videoPath: string) => {
    await fs.remove(videoPath);
    if ((await fs.readdir(defaultVideoDir)).length === 0) {
      await fs.remove(defaultVideoDir);
    }
  };
  await context.close();
  await Promise.all([
    fs
      .move(videoPath, outputPath, { overwrite: true })
      .catch((e) => {
        console.error(
          "Can't create video file. Please check the output path.",
          e,
        );
      })
      .finally(() => void cleanFiles(videoPath)),
      
    browser.close(), // Commented out to keep browser open
  ]);
  
  // Sleep for 5 minutes (300000 milliseconds) before ending the function
  console.log("Waiting for 5 minutes before ending...");
  await new Promise(resolve => setTimeout(resolve, 300000));
  console.log("5 minute wait completed");
  
  return outputPath;
}
