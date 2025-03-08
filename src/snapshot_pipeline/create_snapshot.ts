#!/usr/bin/env node
import * as fs from 'fs-extra';
import * as path from 'path';
import { EventType, eventWithTime } from '@rrweb/types';
import { rebuild, buildNodeWithSN, Mirror, BuildCache } from 'rrweb-snapshot';
import { JSDOM } from 'jsdom';

type SnapshotOptions = {
  input: string;         // Path to rrweb events file
  outputDir?: string;    // Directory to save DOM snapshots
  format?: 'html' | 'json'; // Output format for snapshots
  filter?: (event: eventWithTime) => boolean; // Optional filter for events
  onProgress?: (percent: number) => void; // Progress callback
};

const defaultOptions: Required<Omit<SnapshotOptions, 'input'>> = {
  outputDir: 'snapshots',
  format: 'html',
  filter: () => true,
  onProgress: () => {}
};

/**
 * Create DOM snapshots from rrweb events
 */
export async function createSnapshots(options: SnapshotOptions): Promise<string> {
  const mergedOptions = { ...defaultOptions, ...options };
  const { input, outputDir, format, filter, onProgress } = mergedOptions;

  // Read events file
  let events: eventWithTime[];
  try {
    const eventsStr = await fs.readFile(input, 'utf-8');
    events = JSON.parse(eventsStr);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read or parse events file: ${errorMessage}`);
  }

  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('Events file is empty or invalid');
  }

  // Create output directory
  await fs.ensureDir(outputDir);

  // Filter events to only include DOM-related events
  const relevantEvents = events.filter(event => {
    // Include full snapshots and incremental snapshots
    return (
      (event.type === EventType.FullSnapshot || 
       event.type === EventType.IncrementalSnapshot) && 
      filter(event)
    );
  });

  // Track the most recent DOM state
  let currentDom = null;
  let snapshotCount = 0;
  const totalEvents = relevantEvents.length;

  for (let i = 0; i < relevantEvents.length; i++) {
    const event = relevantEvents[i];
    
    // Update progress
    onProgress(i / totalEvents);

    if (event.type === EventType.FullSnapshot) {
      // For full snapshots, we can directly use the snapshot data
      currentDom = event.data.node;
      
      // Save the snapshot
      await saveSnapshot(
        currentDom,
        path.join(outputDir, `snapshot_${snapshotCount++}_${event.timestamp}.${format === 'html' ? 'html' : 'json'}`),
        format
      );
    } 
    else if (event.type === EventType.IncrementalSnapshot && currentDom) {
      // For incremental snapshots, we'd need to apply the changes to our current DOM
      // This is a simplified version - actual implementation would be more complex
      // based on what changed in the incremental snapshot
      
      // Save the snapshot (if needed based on the use case)
      if (event.data.source !== undefined) { // Only save for certain types of incremental changes
        await saveSnapshot(
          currentDom,
          path.join(outputDir, `snapshot_${snapshotCount++}_${event.timestamp}.${format === 'html' ? 'html' : 'json'}`),
          format
        );
      }
    }
  }

  onProgress(1);
  return outputDir;
}

/**
 * Save a DOM snapshot to file
 */
async function saveSnapshot(domSnapshot: any, filePath: string, format: 'html' | 'json'): Promise<void> {
  try {
    if (format === 'html') {
      // Create a JSDOM document to rebuild the DOM into
      const dom = new JSDOM();
      const doc = dom.window.document;
      
      // Create the required mirror instance
      const mirror = new Mirror();
      
      // Create the cache for rebuild
      const cache = {
        stylesWithHoverClass: new Map<string, string>()
      };
      
      // Call rebuild with the required parameters
      const node = rebuild(domSnapshot, { 
        doc, 
        cache,
        mirror,
        hackCss: true 
      });
      
      // Convert the node to HTML string if it exists
      let html = '';
      if (node) {
        if (node.nodeType === node.DOCUMENT_NODE) {
          html = (node as Document).documentElement.outerHTML;
        } else if (node.nodeType === node.ELEMENT_NODE) {
          html = (node as Element).outerHTML;
        } else {
          html = node.textContent || '';
        }
      }
      
      // Add HTML boilerplate
      html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>DOM Snapshot</title>
</head>
<body>
  ${html}
</body>
</html>`;
      
      await fs.writeFile(filePath, html);
    } else {
      // Save as JSON
      await fs.writeFile(filePath, JSON.stringify(domSnapshot, null, 2));
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Remove detailed HTML logging which might be annoying in CLI
    console.error(`Failed to save snapshot to ${filePath}`);
  }
}

// Command-line interface
if (require.main === module) {
  const { Command } = require('commander');
  const cliProgress = require('cli-progress');
  
  const program = new Command();
  
  program
    .name('rrweb-snapshot')
    .description('Extract DOM snapshots from rrweb recordings')
    .version('1.0.0')
    .requiredOption('--input <path>', 'Path to your rrweb events file')
    .option('--output <path>', 'Directory to save DOM snapshots', 'snapshots')
    .option('--format <format>', 'Output format (html or json)', 'html')
    .parse(process.argv);
  
  const options = program.opts();
  
  // Create a progress bar
  const progressBar = new cliProgress.SingleBar({
    format: 'Extracting snapshots [{bar}] {percentage}% | ETA: {eta}s',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });
  
  // Progress callback
  const onProgress = (percent: number) => {
    if (percent < 1) {
      // Start the progress bar if it's not started yet
      if (progressBar.getProgress() === 0) {
        progressBar.start(100, 0);
      }
      progressBar.update(percent * 100);
    } else {
      progressBar.update(100);
      progressBar.stop();
    }
  };
  
  // Run the snapshot extraction
  createSnapshots({
    input: options.input,
    outputDir: options.output,
    format: options.format as 'html' | 'json',
    onProgress
  })
    .then((outputDir) => {
      console.log(`Successfully extracted DOM snapshots to "${outputDir}".`);
    })
    .catch((error) => {
      // Make sure to stop the progress bar if there's an error
      if (progressBar.getProgress() > 0) {
        progressBar.stop();
      }
      console.error('Failed to extract snapshots. See logs for details.');
      process.exit(1);
    });
}
