#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import * as cliProgress from 'cli-progress';
import type Player from 'rrweb-player';
import { transformToVideo } from './index';

const program = new Command();

program
  .name('rrvideo')
  .description('Transform rrweb session into video')
  .version('2.0.0-alpha.18')
  .requiredOption('--input <path>', 'Path to your rrweb events file')
  .option('--output <path>', 'Path to output video file')
  .option('--config <path>', 'Path to rrweb player configuration file')
  .parse(process.argv);

const options = program.opts();

let config = {};

if (options.config) {
  const configPathStr = options.config;
  const configPath = path.isAbsolute(configPathStr)
    ? configPathStr
    : path.resolve(process.cwd(), configPathStr);
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Omit<
    ConstructorParameters<typeof Player>[0]['props'],
    'events'
  >;
}

// Create a new progress bar instance
const progressBar = new cliProgress.SingleBar({
  format: 'Transforming [{bar}] {percentage}% | ETA: {eta}s',
  barCompleteChar: '\u2588',
  barIncompleteChar: '\u2591',
  hideCursor: true
});

const onProgressUpdate = (percent: number) => {
  if (percent < 1) {
    // Start the progress bar if it's not started yet
    if (progressBar.getProgress() === 0) {
      progressBar.start(100, 0);
    }
    progressBar.update(percent * 100);
  } else {
    progressBar.update(100);
    progressBar.stop();
    console.log('Transformation Completed!');
  }
};

transformToVideo({
  input: options.input,
  output: options.output,
  rrwebPlayer: config,
  onProgressUpdate,
})
  .then((file) => {
    console.log(`Successfully transformed into "${file}".`);
  })
  .catch((error) => {
    // Make sure to stop the progress bar if there's an error
    if (progressBar.getProgress() > 0) {
      progressBar.stop();
    }
    console.log('Failed to transform this session.');
    console.error(error);
    process.exit(1);
  });
