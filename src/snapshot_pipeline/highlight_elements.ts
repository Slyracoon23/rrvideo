#!/usr/bin/env node
import * as fs from 'fs-extra';
import * as path from 'path';
import { Command } from 'commander';
import { chromium } from 'playwright';
import * as cliProgress from 'cli-progress';

type HighlightOptions = {
  input: string;        // Path to HTML file
  outputDir?: string;   // Directory to save screenshots (optional, will use default if not provided)
  selector?: string;    // CSS selector for elements to highlight (default: all elements in the body)
  format?: string;      // Image format (png, jpeg)
  width?: number;       // Viewport width
  height?: number;      // Viewport height
};

const defaultOptions: Omit<HighlightOptions, 'input'> = {
  outputDir: 'element-highlights', // Default parent directory for highlights
  selector: 'body *',   // Select all elements within body by default
  format: 'png',        // Default image format
  width: 1280,          // Default viewport width
  height: 720           // Default viewport height
};

/**
 * Creates a default output directory path based on the HTML filename
 * @param inputPath Path to the input HTML file
 * @param baseOutputDir Base output directory (default: 'element-highlights')
 * @returns Full path to the output directory
 */
function createDefaultOutputPath(inputPath: string, baseOutputDir: string): string {
  // Handle the case where baseOutputDir might be undefined or empty
  const safeBaseDir = baseOutputDir || 'element-highlights';
  
  // Extract the filename without extension
  const filename = path.basename(inputPath, path.extname(inputPath));
  
  // Ensure we have a valid filename, fallback to 'snapshot' if for some reason it's empty
  const safeDirname = filename || 'snapshot';
  
  // Create a path with baseOutputDir/filename
  return path.join(safeBaseDir, safeDirname);
}

/**
 * Takes screenshots of HTML with highlighted elements
 */
async function highlightElements(options: HighlightOptions): Promise<string> {
  // Create a merged options object with defaults
  const mergedOptions = { ...defaultOptions, ...options };
  
  // Extract all options
  const { input, selector, format, width, height } = mergedOptions;
  // Handle outputDir specially to ensure it's always defined
  let outputDir: string = mergedOptions.outputDir || defaultOptions.outputDir!;

  // Ensure the input file exists
  if (!fs.existsSync(input)) {
    throw new Error(`Input file not found: ${input}`);
  }
  
  // If outputDir was not explicitly provided in original options, create a default directory structure
  // based on the HTML filename
  if (!options.outputDir) {
    outputDir = createDefaultOutputPath(input, outputDir);
    console.log(`No output directory specified. Using default: "${outputDir}"`);
  }

  // Create the output directory if it doesn't exist
  const absoluteOutputDir = path.resolve(process.cwd(), outputDir);
  await fs.ensureDir(absoluteOutputDir);

  // Launch the browser
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: width || 1280, height: height || 720 }
  });
  const page = await context.newPage();

  try {
    // Load the HTML file
    const fileUrl = `file://${path.resolve(input)}`;
    await page.goto(fileUrl);

    // Find all elements matching the selector
    const elementSelector = selector || 'body > div, body > main, body > section, body > article';
    const elements = await page.$$(elementSelector);
    console.log(`Found ${elements.length} elements to highlight.`);

    // Create a progress bar
    const progressBar = new cliProgress.SingleBar({
      format: 'Capturing screenshots [{bar}] {percentage}% | {value}/{total} elements | ETA: {eta}s',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });
    progressBar.start(elements.length, 0);

    // Take a screenshot of the original page without highlights
    await page.screenshot({
      path: path.join(absoluteOutputDir, `original.${format || 'png'}`),
      fullPage: true
    });

    // Add a red border to each element one by one and take a screenshot
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      
      // Add a red border to the element
      await page.evaluate((el) => {
        // Save the original style to restore later
        const originalStyle = el.getAttribute('style') || '';
        el.setAttribute('data-original-style', originalStyle);
        
        // Add the red border style exactly as specified by the user
        el.setAttribute('style', `${originalStyle}; border: 2px solid red;`);
      }, element);

      // Take a screenshot
      await page.screenshot({
        path: path.join(absoluteOutputDir, `element_${i + 1}.${format || 'png'}`),
        fullPage: true
      });

      // Restore the original style
      await page.evaluate((el) => {
        const originalStyle = el.getAttribute('data-original-style') || '';
        el.setAttribute('style', originalStyle);
        el.removeAttribute('data-original-style');
      }, element);

      // Update progress
      progressBar.update(i + 1);
    }

    progressBar.stop();
    console.log(`Successfully saved ${elements.length} screenshots to "${absoluteOutputDir}".`);
    
    return absoluteOutputDir;
  } finally {
    // Close the browser
    await browser.close();
  }
}

// CLI implementation
async function main() {
  const program = new Command();

  program
    .name('highlight-elements')
    .description('Create screenshots with highlighted HTML elements')
    .requiredOption('--input <path>', 'Path to the HTML file')
    .option('--output <path>', 'Directory to save screenshots (defaults to element-highlights/[html-name])')
    .option('--selector <selector>', 'CSS selector for elements to highlight (default: "body *")')
    .option('--format <format>', 'Image format (png, jpeg) (default: png)')
    .option('--width <width>', 'Viewport width (default: 1280)')
    .option('--height <height>', 'Viewport height (default: 720)')
    .parse(process.argv);

  const options = program.opts();

  // Create a progress bar for the overall process
  const progressBar = new cliProgress.SingleBar({
    format: 'Processing [{bar}] {percentage}%',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });
  progressBar.start(100, 0);

  // Call the highlightElements function with the provided options
  highlightElements({
    input: options.input,
    outputDir: options.output,
    selector: options.selector,
    format: options.format,
    width: options.width ? parseInt(options.width, 10) : undefined,
    height: options.height ? parseInt(options.height, 10) : undefined
  })
    .then((outputDir) => {
      progressBar.update(100);
      progressBar.stop();
      console.log(`Successfully created screenshots in "${outputDir}".`);
    })
    .catch((error) => {
      progressBar.stop();
      console.error('Failed to create screenshots:', error.message);
      process.exit(1);
    });
}

// Run the CLI if this file is executed directly
if (require.main === module) {
  main();
}

// Export the highlightElements function for programmatic use
export { highlightElements }; 