const fs = require('fs');
const path = require('path');

// Read the input file
const inputFile = path.join(__dirname, '../docs/allocations_response_mar_17th.json');
const outputFile = path.join(__dirname, '../docs/allocations_response_mar_17th_filtered.json');

console.log('Reading input file:', inputFile);
const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

// Filter entries where allocated_assets >= 1000
const filteredResults = data.data.results.filter(entry => {
  const allocatedAssets = parseFloat(entry.allocated_assets);
  return allocatedAssets >= 1000;
});

console.log(`Original entries: ${data.data.results.length}`);
console.log(`Filtered entries (allocated_assets >= 1000): ${filteredResults.length}`);

// Create the filtered data structure
const filteredData = {
  data: {
    results: filteredResults
  }
};

// Convert to JSON with PowerShell-style formatting (4 spaces indentation)
const jsonString = JSON.stringify(filteredData, null, 4);

// Write to output file
fs.writeFileSync(outputFile, jsonString, 'utf8');
console.log('Filtered data written to:', outputFile);
