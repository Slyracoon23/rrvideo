import * as fs from 'fs-extra';
import * as path from 'path';
import { chromium } from 'playwright';
import { EventType, eventWithTime } from '@rrweb/types';
import type Player from 'rrweb-player';

// The max valid scale value for the scaling method which can improve the video quality.
const MaxScaleValue = 2.5;

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
    <style>html, body {padding: 0; border: none; margin: 0;}</style>
    
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
    <!-- Player will be inserted here -->
  </body>
  
  <script>
    document.addEventListener('DOMContentLoaded', () => {
      const userConfig = ${JSON.stringify(config?.rrwebPlayer || {})};
      
      // Hard code to full screen dimensions
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      // Create the rrweb player instance
      window.replayer = new rrwebPlayer({
        target: document.body,
        width: width,
        height: height,
        props: {
          events,
          showController: false,
          skipInactive: true,
          showDebug: false,
          showWarning: false,
          autoPlay: true,
          mouseTail: {
            strokeStyle: 'yellow',
          },
        },
      });
      
      // Add event listeners
      window.replayer.addEventListener('finish', () => window.onReplayFinish());
      window.replayer.addEventListener('ui-update-progress', (payload) => window.onReplayProgressUpdate(payload));
      
      // Force the player to be full screen
      const resizePlayer = () => {
        const wrapper = document.querySelector('.replayer-wrapper');
        if (wrapper) {
          wrapper.style.width = '100%';
          wrapper.style.height = '100%';
          wrapper.style.transform = 'none';
        }
      };
      
    });
  </script>
</html>
`;
}

/**
 * Preprocess all events to get a maximum view port size.
 */
function getMaxViewport(events: eventWithTime[]) {
  let maxWidth = 1024,
    maxHeight = 576;
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
    browser.close(),
  ]);
  return outputPath;
}
