#!/bin/bash

# Script to run highlight_elements.ts on all HTML files in the snapshots directory
# This will create element highlights for each HTML snapshot in parallel

# Default settings
SNAPSHOTS_DIR="./snapshots"
OUTPUT_BASE_DIR="./element-highlights"
MAX_FILES=0  # 0 means process all files
PATTERN="*.html"  # Default pattern to match all HTML files
MAX_JOBS=0  # 0 means use all available CPU cores

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --input-dir)
      SNAPSHOTS_DIR="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_BASE_DIR="$2"
      shift 2
      ;;
    --max-files)
      MAX_FILES="$2"
      shift 2
      ;;
    --pattern)
      PATTERN="$2"
      shift 2
      ;;
    --jobs)
      MAX_JOBS="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --input-dir DIR    Directory containing HTML files (default: ./snapshots)"
      echo "  --output-dir DIR   Base directory for output (default: ./element-highlights)"
      echo "  --max-files N      Process at most N files (default: 0, process all)"
      echo "  --pattern PATTERN  File pattern to match (default: *.html)"
      echo "  --jobs N           Number of parallel jobs (default: 0, use all CPU cores)"
      echo "  --help             Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Check if GNU Parallel is installed
if ! command -v parallel &> /dev/null; then
  echo "GNU Parallel is not installed. Please install it first."
  echo "On Ubuntu/Debian: sudo apt-get install parallel"
  echo "On macOS with Homebrew: brew install parallel"
  exit 1
fi

# Create the output directory if it doesn't exist
mkdir -p "$OUTPUT_BASE_DIR"

# Build the list of files to process
if [ $MAX_FILES -gt 0 ]; then
  FILES_TO_PROCESS=$(find "$SNAPSHOTS_DIR" -name "$PATTERN" | head -n $MAX_FILES)
else
  FILES_TO_PROCESS=$(find "$SNAPSHOTS_DIR" -name "$PATTERN")
fi

# Count total HTML files for reporting
TOTAL_FILES=$(echo "$FILES_TO_PROCESS" | wc -l)
echo "Found $TOTAL_FILES HTML files to process"

# Set up parallel jobs parameter
PARALLEL_JOBS_ARG=""
if [ $MAX_JOBS -gt 0 ]; then
  PARALLEL_JOBS_ARG="-j $MAX_JOBS"
  echo "Using $MAX_JOBS parallel jobs"
else
  # Use 500% of CPU cores by default (5x the cores)
  PARALLEL_JOBS_ARG="-j 500%"
  echo "Using 500% of CPU cores for parallel processing"
fi

echo "----------------------------------------"

# Define the processing function
process_file() {
  HTML_FILE="$1"
  # Need to make OUTPUT_BASE_DIR available in the function for parallel execution
  OUTPUT_BASE_DIR="$2"
  
  FILENAME=$(basename "$HTML_FILE")
  FILENAME_NO_EXT="${FILENAME%.*}"
  
  # First create the output directory
  OUTPUT_DIR="${OUTPUT_BASE_DIR}/${FILENAME_NO_EXT}"
  mkdir -p "$OUTPUT_DIR"
  
  # Now get absolute paths after directories exist
  ABS_HTML_FILE=$(realpath "$HTML_FILE")
  ABS_OUTPUT_DIR=$(realpath "$OUTPUT_DIR")
  
  echo "Processing $FILENAME..."
  
  # Run the highlight_elements script with absolute paths
  pnpm exec ts-node src/snapshot_pipeline/highlight_elements.ts \
    --input "$ABS_HTML_FILE" \
    --output "$ABS_OUTPUT_DIR" \
    --format png \
    --width 1280 \
    --height 720
  
  # Check if the command was successful
  if [ $? -eq 0 ]; then
    echo "Successfully processed $FILENAME"
    return 0
  else
    echo "ERROR: Failed to process $FILENAME"
    return 1
  fi
}

# Export the function so parallel can use it
export -f process_file

# Process files in parallel with visible console output
# And simultaneously capture success/failure status for counting
RESULTS_FILE=$(mktemp)
echo "$FILES_TO_PROCESS" | parallel $PARALLEL_JOBS_ARG --tee "$RESULTS_FILE" "process_file {} \"$OUTPUT_BASE_DIR\" && echo SUCCESS || echo FAIL"

# Count successful and failed files from the results file
SUCCESSFUL_FILES=$(grep -c "SUCCESS" "$RESULTS_FILE")
FAILED_FILES=$(grep -c "FAIL" "$RESULTS_FILE")

# Clean up temp file
rm "$RESULTS_FILE"

echo "----------------------------------------"
echo "Processing complete!"
echo "Total files processed: $TOTAL_FILES"
echo "Successfully processed: $SUCCESSFUL_FILES"
echo "Failed to process: $FAILED_FILES"
echo "Element highlights are available in $OUTPUT_BASE_DIR"

# Exit with error code if any files failed
if [ $FAILED_FILES -gt 0 ]; then
  exit 1
fi 