#!/usr/bin/env node
import * as fs from 'fs-extra';
import * as path from 'path';
import { Command } from 'commander';
import { chromium, ElementHandle } from 'playwright';
import * as cliProgress from 'cli-progress';

type HighlightOptions = {
  input: string;        // Path to HTML file
  outputDir?: string;   // Directory to save screenshots (optional, will use default if not provided)
  selector?: string;    // CSS selector for container element (default: first of body > div/main/section/article)
  format?: string;      // Image format (png, jpeg)
  width?: number;       // Viewport width
  height?: number;      // Viewport height
};

const defaultOptions: Omit<HighlightOptions, 'input'> = {
  outputDir: 'element-highlights', 
  selector: 'body > div, body > main, body > section, body > article',
  format: 'png',
  width: 1280,
  height: 720
};

/**
 * Creates a default output directory path based on the HTML filename.
 */
function createDefaultOutputPath(inputPath: string, baseOutputDir: string): string {
  const safeBaseDir = baseOutputDir || 'element-highlights';
  const filename = path.basename(inputPath, path.extname(inputPath));
  const safeDirname = filename || 'snapshot';
  return path.join(safeBaseDir, safeDirname);
}

/**
 * Recursively collects all descendant ElementHandles of a given element
 * and returns a flattened array.
 * @param element - The starting ElementHandle.
 * @returns A Promise resolving to a flattened array of descendant ElementHandles.
 */
async function getFlattenedDescendants(element: ElementHandle<Element>): Promise<ElementHandle<Element>[]> {
  // Get immediate children using the direct-child selector.
  const children = await element.$$('> *');
  let results: ElementHandle<Element>[] = [];
  for (const child of children) {
    results.push(child);
    // Recursively retrieve descendants from each child.
    const subDescendants = await getFlattenedDescendants(child);
    results.push(...subDescendants);
  }
  return results;
}

/**
 * Highlights each descendant element by adding a red border, takes a screenshot,
 * and then restores the element's original style.
 */
async function highlightElements(options: HighlightOptions): Promise<string> {
  const mergedOptions = { ...defaultOptions, ...options };
  const { input, selector, format, width, height } = mergedOptions;
  let outputDir: string = mergedOptions.outputDir || defaultOptions.outputDir!;

  if (!fs.existsSync(input)) {
    throw new Error(`Input file not found: ${input}`);
  }

  // If no output directory was provided, create one based on the HTML filename.
  if (!options.outputDir) {
    outputDir = createDefaultOutputPath(input, outputDir);
    console.log(`No output directory specified. Using default: "${outputDir}"`);
  }
  const absoluteOutputDir = path.resolve(process.cwd(), outputDir);
  await fs.ensureDir(absoluteOutputDir);

  // Launch the browser.
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: width || 1280, height: height || 720 }
  });
  const page = await context.newPage();

  try {
    const fileUrl = `file://${path.resolve(input)}`;
    await page.goto(fileUrl);

    // Get the container element using the provided (or default) selector.
    const selectorToUse = selector || defaultOptions.selector || 'body > div, body > main, body > section, body > article';
    const container = await page.$(selectorToUse);
    if (!container) {
      console.log(`No element found matching selector: ${selectorToUse}`);
      return absoluteOutputDir;
    }

    // Use the recursive helper to get a flattened array of descendant handles.
    const descendantHandles = await getFlattenedDescendants(container);
    console.log(`Found ${descendantHandles.length} descendant elements (flattened).`);

    // Create a progress bar.
    const progressBar = new cliProgress.SingleBar({
      format: 'Capturing screenshots [{bar}] {percentage}% | {value}/{total} elements | ETA: {eta}s',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });
    progressBar.start(descendantHandles.length, 0);

    // Optionally take a full-page screenshot of the original page.
    await page.screenshot({
      path: path.join(absoluteOutputDir, `original.${format || 'png'}`),
      fullPage: true
    });

    // Process each descendant element.
    for (let i = 0; i < descendantHandles.length; i++) {
      const handle = descendantHandles[i];

      // Save the original style and add a red border with !important to override any existing styles
      await page.evaluate((el) => {
        const originalStyle = el.getAttribute('style') || '';
        el.setAttribute('data-original-style', originalStyle);
        el.setAttribute('style', `${originalStyle}; border: 4px solid red !important;`);
      }, handle);

      // Add a small delay to ensure the highlight is visible
      await page.waitForTimeout(200);

      // Take a screenshot of the entire page with the highlighted element
      await page.screenshot({
        path: path.join(absoluteOutputDir, `element_${i + 1}.${format || 'png'}`),
        fullPage: true
      });

      // Restore the original style.
      await page.evaluate((el) => {
        const originalStyle = el.getAttribute('data-original-style') || '';
        el.setAttribute('style', originalStyle);
        el.removeAttribute('data-original-style');
      }, handle);

      progressBar.update(i + 1);
    }
    progressBar.stop();
    console.log(`Successfully saved ${descendantHandles.length} element screenshots to "${absoluteOutputDir}".`);
    return absoluteOutputDir;
  } finally {
    await browser.close();
  }
}

// CLI implementation.
async function main() {
  const program = new Command();
  program
    .name('highlight-elements')
    .description('Create screenshots with highlighted HTML elements')
    .requiredOption('--input <path>', 'Path to the HTML file')
    .option('--output <path>', 'Directory to save screenshots (defaults to element-highlights/[html-name])')
    .option('--selector <selector>', 'CSS selector for container element (default: "body > div, body > main, body > section, body > article")')
    .option('--format <format>', 'Image format (png, jpeg) (default: png)')
    .option('--width <width>', 'Viewport width (default: 1280)')
    .option('--height <height>', 'Viewport height (default: 720)')
    .parse(process.argv);
    
  const options = program.opts();
  const overallProgressBar = new cliProgress.SingleBar({
    format: 'Processing [{bar}] {percentage}%',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });
  overallProgressBar.start(100, 0);

  highlightElements({
    input: options.input,
    outputDir: options.output,
    selector: options.selector,
    format: options.format,
    width: options.width ? parseInt(options.width, 10) : undefined,
    height: options.height ? parseInt(options.height, 10) : undefined
  })
    .then((outputDir) => {
      overallProgressBar.update(100);
      overallProgressBar.stop();
      console.log(`Successfully created screenshots in "${outputDir}".`);
    })
    .catch((error) => {
      overallProgressBar.stop();
      console.error('Failed to create screenshots:', error.message);
      process.exit(1);
    });
}

if (require.main === module) {
  main();
}

export { highlightElements };
