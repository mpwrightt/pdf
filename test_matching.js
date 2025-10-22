#!/usr/bin/env node
/**
 * Test Script for Order Matching Logic
 * This replicates the Google Apps Script logic to test locally
 */

const fs = require('fs');

// Read the files
const csvPath = '/Users/mpwright/Discrep/Copy of Helper Discrep Doc 3 - Sheet9 (3).csv';
const txtPath = '/Users/mpwright/Discrep/SQ_251013-236rmb_Sheets.txt';

const csvData = fs.readFileSync(csvPath, 'utf-8');
const pdfText = fs.readFileSync(txtPath, 'utf-8');

// Parse CSV (properly handle quoted fields)
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim()); // Last value
    
    const row = {
      directOrder: values[0] || '',
      buyerName: values[1] || '',
      sqNumber: values[2] || '',
      game: values[3] || '',
      cardName: values[4]?.replace(/^"|"$/g, '') || '',
      collectorNum: values[5] || '',
      rarity: values[6] || '',
      setName: values[7]?.replace(/^"|"$/g, '') || '',
      condition: values[8] || '',
      quantity: parseInt(values[9]) || 0,
      rowNum: i + 1
    };
    rows.push(row);
  }
  
  return rows;
}

// Parse orders from PDF text
function parseOrders(text) {
  const orders = [];
  
  // First, find all order sections using "Order Number: XXXXXX | Page X of X" pattern
  const orderSectionPattern = /Order Number: (\d{6}-[A-F0-9]{4}) \| Page (\d+) of (\d+)/g;
  const orderSections = [];
  
  let match;
  while ((match = orderSectionPattern.exec(text)) !== null) {
    const orderNum = match[1];
    const pageNum = parseInt(match[2]);
    const totalPages = parseInt(match[3]);
    
    orderSections.push({
      orderNumber: orderNum,
      pageNum: pageNum,
      totalPages: totalPages,
      position: match.index
    });
  }
  
  // Group by order number and find start/end positions
  const orderGroups = {};
  
  for (const section of orderSections) {
    if (!orderGroups[section.orderNumber]) {
      orderGroups[section.orderNumber] = {
        orderNumber: section.orderNumber,
        pages: [],
        firstPagePos: Infinity,
        lastPagePos: -1
      };
    }
    
    orderGroups[section.orderNumber].pages.push(section);
    orderGroups[section.orderNumber].firstPagePos = Math.min(orderGroups[section.orderNumber].firstPagePos, section.position);
    orderGroups[section.orderNumber].lastPagePos = Math.max(orderGroups[section.orderNumber].lastPagePos, section.position);
  }
  
  // Set startPos to first page, temporarily set endPos to last page (will adjust below)
  for (const orderNum in orderGroups) {
    orderGroups[orderNum].startPos = orderGroups[orderNum].firstPagePos;
    orderGroups[orderNum].endPos = orderGroups[orderNum].lastPagePos + 5000; // Add buffer to include content after last page marker
  }
  
  // Now get buyer names from "Direct by TCGplayer #" sections
  const buyerPattern = /Direct by TCGplayer #\s*\n\s*\n\s*(\d{6}-[A-F0-9]{4})\s*\n\s*\n\s*([^\n]+)/g;
  
  while ((match = buyerPattern.exec(text)) !== null) {
    const orderNum = match[1];
    const buyerName = match[2].trim();
    
    if (orderGroups[orderNum]) {
      orderGroups[orderNum].buyerName = buyerName;
    }
  }
  
  // Convert to array and sort by start position
  const orderArray = Object.values(orderGroups).sort((a, b) => a.startPos - b.startPos);
  
  // Calculate proper end positions
  // Each order's endPos extends to just before the next order's startPos
  // This way cards between the last page marker and the next order belong to the current order
  for (let i = 0; i < orderArray.length; i++) {
    if (i < orderArray.length - 1) {
      // End where the next order starts
      orderArray[i].endPos = orderArray[i + 1].startPos;
    } else {
      // Last order extends to end of file
      orderArray[i].endPos = text.length;
    }
  }
  
  return orderArray;
}

// Check condition near card
function checkConditionNearCard(text, cardPosition, condition) {
  const windowSize = 500;
  const start = Math.max(0, cardPosition - windowSize);
  const end = Math.min(text.length, cardPosition + windowSize);
  const window = text.substring(start, end);
  
  const conditionMap = {
    'NM': 'Near Mint',
    'NMF': 'Near Mint Foil',
    'LP': 'Lightly Played',
    'LPF': 'Lightly Played Foil',
    'MP': 'Moderately Played',
    'MPF': 'Moderately Played Foil',
    'HP': 'Heavily Played',
  };
  
  const conditionText = conditionMap[condition] || condition;
  
  // Normalize whitespace in window to handle line breaks
  const normalizedWindow = window.replace(/\s+/g, ' ').trim();
  const normalizedCondition = conditionText.replace(/\s+/g, ' ').trim();
  
  const matches = normalizedWindow.includes(normalizedCondition);
  
  return {
    matches: matches,
    conditionText: conditionText
  };
}

// Extract quantity near card
function extractQuantityNearCard(text, cardPosition) {
  const windowSize = 200;
  const start = Math.max(0, cardPosition - windowSize);
  const window = text.substring(start, cardPosition);
  
  const qtyPattern = /\n\n(\d+)\n\n/g;
  const matches = [];
  let match;
  
  while ((match = qtyPattern.exec(window)) !== null) {
    matches.push({
      quantity: parseInt(match[1]),
      position: match.index
    });
  }
  
  if (matches.length > 0) {
    return matches[matches.length - 1].quantity;
  }
  
  return null;
}

// Find card in orders
function findCardInOrders(cardName, condition, quantity, orders, fullText) {
  const searchName = cardName.replace(/["""]/g, '"').trim();
  const occurrences = [];
  
  // Search patterns
  const patterns = [searchName, searchName.replace(/"/g, '')];
  
  for (const pattern of patterns) {
    // Escape regex special characters FIRST, then replace spaces with \s+
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped.replace(/\s+/g, '\\s+'), 'gi');
    let match;
    
    while ((match = regex.exec(fullText)) !== null) {
      occurrences.push({ position: match.index });
    }
    
    if (occurrences.length > 0) break;
  }
  
  if (occurrences.length === 0) {
    return [];
  }
  
  console.log(`    Found ${occurrences.length} occurrence(s) of "${searchName}"`);
  
  // Match to orders
  const matches = [];
  
  // Find the position of the FIRST order (to skip inventory section)
  const firstOrderPos = orders.length > 0 ? orders[0].startPos : 0;
  
  for (const occ of occurrences) {
    // Skip occurrences before the first order (inventory section)
    if (occ.position < firstOrderPos) {
      console.log(`    ⏭️  Skipping inventory section at pos ${occ.position}`);
      continue;
    }
    
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      
      // Check if this card position falls within this order's range
      if (occ.position >= order.startPos && occ.position < order.endPos) {
        // Check condition
        const conditionInfo = checkConditionNearCard(fullText, occ.position, condition);
        if (!conditionInfo.matches) {
          console.log(`    ❌ Pos ${occ.position}: Condition mismatch (need ${condition})`);
          continue;
        }
        
        // Check quantity
        let quantityMatches = true;
        if (quantity) {
          const pdfQuantity = extractQuantityNearCard(fullText, occ.position);
          const expectedQuantity = Math.abs(quantity);
          
          if (pdfQuantity && pdfQuantity !== expectedQuantity) {
            console.log(`    ❌ Pos ${occ.position}: Quantity mismatch (expected ${expectedQuantity}, found ${pdfQuantity})`);
            quantityMatches = false;
          } else if (pdfQuantity) {
            console.log(`    ✅ Pos ${occ.position}: Quantity match (${pdfQuantity})`);
          }
        }
        
        if (!quantityMatches) {
          continue;
        }
        
        console.log(`    ✅ Match: ${order.orderNumber} (${order.buyerName})`);
        matches.push({
          orderNumber: order.orderNumber,
          buyerName: order.buyerName,
          position: occ.position
        });
        break;
      }
    }
  }
  
  if (matches.length > 1) {
    console.log(`    ⚠️  WARNING: Found ${matches.length} matching orders!`);
  }
  
  return matches;
}

// Main test
function runTest() {
  console.log('=== Testing Order Matching Logic ===\n');
  
  const cards = parseCSV(csvData);
  const orders = parseOrders(pdfText);
  
  console.log(`Loaded ${cards.length} cards`);
  console.log(`Found ${orders.length} orders\n`);
  
  // Debug: Show first few orders
  console.log('First 5 orders:');
  orders.slice(0, 5).forEach((order, i) => {
    console.log(`  ${i + 1}. ${order.orderNumber} (${order.buyerName}) - pos ${order.startPos} to ${order.endPos}`);
  });
  
  // Debug: Find specific orders
  const order34E5 = orders.find(o => o.orderNumber === '251012-34E5');
  const order6261 = orders.find(o => o.orderNumber === '251012-6261');
  if (order34E5) console.log(`\nOrder 251012-34E5: pos ${order34E5.startPos} to ${order34E5.endPos}`);
  if (order6261) console.log(`Order 251012-6261: pos ${order6261.startPos} to ${order6261.endPos}`);
  console.log('Lizard Blades LP is at position 101059\n');
  
  let processedCount = 0;
  let errorCount = 0;
  let duplicateCount = 0;
  let mismatchCount = 0;
  
  const results = [];
  
  for (const card of cards) {
    console.log(`\n📋 Row ${card.rowNum}: ${card.cardName} (${card.condition}, qty ${card.quantity})`);
    
    // Clear existing assignments to test fresh
    const existingOrder = card.directOrder;
    const existingBuyer = card.buyerName;
    
    const matches = findCardInOrders(card.cardName, card.condition, card.quantity, orders, pdfText);
    
    if (matches.length === 0) {
      console.log(`  ❌ ERROR: Could not find order`);
      errorCount++;
      results.push({
        ...card,
        status: 'ERROR',
        foundOrder: null,
        foundBuyer: null
      });
    } else if (matches.length === 1) {
      const match = matches[0];
      console.log(`  ✅ MATCH: ${match.orderNumber} (${match.buyerName})`);
      
      // Verify against existing
      if (existingOrder && existingOrder !== match.orderNumber) {
        console.log(`  ⚠️  MISMATCH: Expected ${existingOrder}, found ${match.orderNumber}`);
        mismatchCount++;
      }
      
      processedCount++;
      results.push({
        ...card,
        status: 'OK',
        foundOrder: match.orderNumber,
        foundBuyer: match.buyerName,
        matches: existingOrder === match.orderNumber
      });
    } else {
      console.log(`  🔄 DUPLICATE: Found in ${matches.length} orders`);
      for (let i = 0; i < matches.length; i++) {
        console.log(`     ${i === 0 ? 'PRIMARY' : `DUPLICATE ${i}`}: ${matches[i].orderNumber} (${matches[i].buyerName})`);
      }
      duplicateCount += matches.length - 1;
      processedCount++;
      
      results.push({
        ...card,
        status: 'DUPLICATE',
        foundOrder: matches.map(m => m.orderNumber).join(', '),
        foundBuyer: matches.map(m => m.buyerName).join(', '),
        duplicates: matches.length - 1
      });
    }
  }
  
  // Summary
  console.log('\n\n=== SUMMARY ===');
  console.log(`✅ Processed: ${processedCount} cards`);
  console.log(`❌ Errors: ${errorCount} cards`);
  console.log(`🔄 Duplicates: ${duplicateCount} additional rows would be created`);
  console.log(`⚠️  Mismatches: ${mismatchCount} cards differ from manual assignment`);
  
  // Show mismatches
  if (mismatchCount > 0) {
    console.log('\n=== MISMATCHES ===');
    results.filter(r => r.matches === false).forEach(r => {
      console.log(`Row ${r.rowNum}: ${r.cardName}`);
      console.log(`  Manual: ${r.directOrder} (${r.buyerName})`);
      console.log(`  Script: ${r.foundOrder} (${r.foundBuyer})`);
    });
  }
  
  // Show duplicates
  if (duplicateCount > 0) {
    console.log('\n=== DUPLICATES (Would Create New Rows) ===');
    results.filter(r => r.status === 'DUPLICATE').forEach(r => {
      console.log(`Row ${r.rowNum}: ${r.cardName} → ${r.duplicates + 1} orders`);
      console.log(`  Orders: ${r.foundOrder}`);
    });
  }
}

// Run the test
runTest();
