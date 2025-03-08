#!/bin/bash

# Check if data directory exists
if [ ! -d "./data" ]; then
    echo "Error: data directory not found"
    exit 1
fi

# Find all JSON files in the data directory
json_files=$(find ./data -name "*.json")

# Check if any JSON files were found
if [ -z "$json_files" ]; then
    echo "No JSON files found in the data directory"
    exit 1
fi

# Process all JSON files in parallel
for json_file in $json_files; do
    # Extract the base filename without extension
    base_name=$(basename "$json_file" .json)
    
    # Define output filename
    output_file="./data/${base_name}.webm"
    
    echo "Starting conversion of $json_file to $output_file"
    
    # Run conversion in background
    pnpm ts-node src/cli.ts --input "$json_file" --output "$output_file" &
done

# Wait for all background processes to finish
echo "All conversion jobs started. Waiting for them to complete..."
wait

echo "All video conversions completed!" 