#!/bin/bash

# Script to run highlight_elements.ts on all HTML files in the snapshots directory
# This will create element highlights for each HTML snapshot

# Default settings
SNAPSHOTS_DIR="./snapshots"
OUTPUT_BASE_DIR="./element-highlights"
MAX_FILES=0  # 0 means process all files
PATTERN="*.html"  # Default pattern to match all HTML files

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
    --help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --input-dir DIR    Directory containing HTML files (default: ./snapshots)"
      echo "  --output-dir DIR   Base directory for output (default: ./element-highlights)"
      echo "  --max-files N      Process at most N files (default: 0, process all)"
      echo "  --pattern PATTERN  File pattern to match (default: *.html)"
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

# Create the output directory if it doesn't exist
mkdir -p "$OUTPUT_BASE_DIR"

# Count total HTML files for progress reporting
TOTAL_FILES=$(find "$SNAPSHOTS_DIR" -name "$PATTERN" | wc -l)
CURRENT_FILE=0
FAILED_FILES=0
SUCCESSFUL_FILES=0

# Adjust total files if max-files is set
if [ $MAX_FILES -gt 0 ] && [ $MAX_FILES -lt $TOTAL_FILES ]; then
  echo "Limiting to $MAX_FILES files out of $TOTAL_FILES total files"
  TOTAL_FILES=$MAX_FILES
else
  echo "Found $TOTAL_FILES HTML files to process"
fi

echo "----------------------------------------"

# Process each HTML file
for HTML_FILE in "$SNAPSHOTS_DIR"/$PATTERN; do
  if [ -f "$HTML_FILE" ]; then
    # Check if we've reached the maximum number of files
    if [ $MAX_FILES -gt 0 ] && [ $CURRENT_FILE -ge $MAX_FILES ]; then
      echo "Reached maximum number of files to process ($MAX_FILES)"
      break
    fi
    
    FILENAME=$(basename "$HTML_FILE")
    FILENAME_NO_EXT="${FILENAME%.*}"
    OUTPUT_DIR="$OUTPUT_BASE_DIR/$FILENAME_NO_EXT"
    
    # Increment counter
    ((CURRENT_FILE++))
    
    echo "[$CURRENT_FILE/$TOTAL_FILES] Processing $FILENAME..."
    
    # Run the highlight_elements script directly with ts-node using pnpm exec
    # This avoids issues with argument passing through npm/pnpm scripts
    pnpm exec ts-node src/snapshot_pipeline/highlight_elements.ts --input "$HTML_FILE" --output "$OUTPUT_DIR" --format png --width 1280 --height 720
    
    # Check if the command was successful
    if [ $? -eq 0 ]; then
      ((SUCCESSFUL_FILES++))
      echo "Successfully processed $FILENAME"
    else
      ((FAILED_FILES++))
      echo "ERROR: Failed to process $FILENAME"
    fi
    
    # Add a small delay between processing files to avoid potential resource issues
    sleep 1
    
    echo "Completed processing $FILENAME"
    echo "----------------------------------------"
  fi
done

echo "Processing complete!"
echo "Total files processed: $CURRENT_FILE"
echo "Successfully processed: $SUCCESSFUL_FILES"
echo "Failed to process: $FAILED_FILES"
echo "Element highlights are available in $OUTPUT_BASE_DIR"

# Exit with error code if any files failed
if [ $FAILED_FILES -gt 0 ]; then
  exit 1
fi 