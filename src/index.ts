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
      }
      
      /* Responsive container structure */
      .player-container {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        overflow: hidden;
      }
      
      /* Player wrapper to maintain aspect ratio and handle scaling */
      .player-wrapper {
        position: relative;
        transform-origin: center center;
        width: 100%;
        height: 100%;
      }
      
      /* Ensure replayer elements maintain proper scaling */
      .replayer-wrapper {
        position: absolute;
        top: 50%;
        left: 50%;
        transform-origin: center center;
      }
      
      /* Style the mouse trail canvas */
      .replayer-mouse-tail {
        position: absolute;
        pointer-events: none;
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
    <!-- Responsive container structure -->
    <div class="player-container">
      <div class="player-wrapper" id="player-wrapper">
        <!-- Player will be inserted here -->
      </div>
    </div>
  </body>
  
  <script>
    document.addEventListener('DOMContentLoaded', () => {
      const userConfig = ${JSON.stringify(config?.rrwebPlayer || {})};
      
      // Get container dimensions
      const container = document.querySelector('.player-container');
      const wrapper = document.getElementById('player-wrapper');
      
      // Original content dimensions from config
      const contentWidth = userConfig.width || 1280; // Default if not specified
      const contentHeight = userConfig.height || 720; // Default if not specified
      const aspectRatio = contentWidth / contentHeight;
      
      // Create the rrweb player instance
      window.replayer = new rrwebPlayer({
        target: wrapper,
        width: contentWidth,
        height: contentHeight,
        props: {
          events,
          showController: false,
          skipInactive: true,
          autoPlay: true,
          mouseTail: {
            strokeStyle: 'yellow',
          },
          ...userConfig,
        },
      });
      
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
      
      // Function to adjust scaling based on container size
      const adjustScaling = () => {
        requestAnimationFrame(() => {
          const containerWidth = container.clientWidth;
          const containerHeight = container.clientHeight;
          
          // Calculate scale to fit the container while maintaining aspect ratio
          let scale;
          if (containerWidth / containerHeight > aspectRatio) {
            // Container is wider than content aspect ratio
            scale = containerHeight / contentHeight;
          } else {
            // Container is taller than content aspect ratio
            scale = containerWidth / contentWidth;
          }
          
          // Apply scaling to the replayer wrapper
          const replayerWrapper = wrapper.querySelector('.replayer-wrapper');
          if (replayerWrapper) {
            replayerWrapper.style.transform = \`scale(\${scale}) translate(-50%, -50%)\`;
            
            // Scale mouse trail canvas
            const mouseTail = document.querySelector('.replayer-mouse-tail');
            if (mouseTail) {
              mouseTail.style.transform = \`scale(\${scale})\`;
              mouseTail.style.transformOrigin = 'top left';
            }
          }
        });
      };
      
      // Initial scaling adjustment
      setTimeout(adjustScaling, 100); // Small delay to ensure player is rendered
      
      // Set up ResizeObserver to detect container size changes
      const resizeObserver = new ResizeObserver(() => {
        adjustScaling();
      });
      
      resizeObserver.observe(container);
      
      // Also handle window resize events as a fallback
      window.addEventListener('resize', adjustScaling);
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

  // Make the browser viewport fit the player size.
  // const maxViewport = getMaxViewport(events);
  const maxViewport = {
    width: 2048,
    height: 1152,
  };
  // Use the scaling method to improve the video quality.
  const scaledViewport = {
    width: Math.round(
      maxViewport.width * (config.resolutionRatio ?? 1) * MaxScaleValue,
    ),
    height: Math.round(
      maxViewport.height * (config.resolutionRatio ?? 1) * MaxScaleValue,
    ),
  };
  Object.assign(config.rrwebPlayer, scaledViewport);
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
      
    // browser.close(), // Commented out to keep browser open
  ]);
  
  // Sleep for 5 minutes (300000 milliseconds) before ending the function
  console.log("Waiting for 5 minutes before ending...");
  await new Promise(resolve => setTimeout(resolve, 300000));
  console.log("5 minute wait completed");
  
  return outputPath;
}
