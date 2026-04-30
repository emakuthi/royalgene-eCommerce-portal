/**
 * CSV Parser utility for bulk product uploads
 * Converts CSV data to product objects with validation
 */

export interface ParsedProductRow {
  name: string;
  description: string;
  price: number;
  category: 'dresses' | 'shoes' | 'trousers' | 'textiles';
  images?: string[];
  sizes?: string[];
  colors?: string[];
  stockQuantity: number;
  sku: string;
  featured?: boolean;
  trending?: boolean;
}

interface ValidationError {
  row: number;
  field: string;
  error: string;
  value?: unknown;
}

/**
 * Parse CSV content and return array of products
 * Expected CSV columns:
 * - name (required)
 * - description (required)
 * - price (required)
 * - category (required: dresses, shoes, trousers, textiles)
 * - sku (required)
 * - stockQuantity (required)
 * - sizes (optional: comma-separated, e.g., "XS,S,M,L,XL")
 * - colors (optional: comma-separated, e.g., "Red,Blue,Green")
 * - featured (optional: true/false)
 * - trending (optional: true/false)
 */
export function parseCSV(
  csvContent: string
): { products: ParsedProductRow[]; errors: ValidationError[] } {
  const lines = csvContent.trim().split('\n');
  const products: ParsedProductRow[] = [];
  const errors: ValidationError[] = [];

  if (lines.length < 2) {
    errors.push({
      row: 0,
      field: 'csv',
      error: 'CSV must contain header row and at least one data row',
    });
    return { products, errors };
  }

  // Parse header
  const headerLine = lines[0];
  const headers = headerLine.split(',').map(h => h.trim().toLowerCase());

  // Validate required headers
  const requiredHeaders = ['name', 'description', 'price', 'category', 'sku', 'stockquantity'];
  const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));

  if (missingHeaders.length > 0) {
    errors.push({
      row: 0,
      field: 'headers',
      error: `Missing required columns: ${missingHeaders.join(', ')}`,
    });
    return { products, errors };
  }

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines

    try {
      const values = parseCSVLine(line);
      const product = parseProductRow(values, headers, i + 1, errors);

      if (product) {
        products.push(product);
      }
    } catch (error) {
      errors.push({
        row: i + 1,
        field: 'row',
        error: `Failed to parse row: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  return { products, errors };
}

/**
 * Parse a single CSV line, handling quoted fields with commas
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      // Field separator
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Add last field
  values.push(current.trim());

  return values;
}

/**
 * Parse a single product row from CSV
 */
function parseProductRow(
  values: string[],
  headers: string[],
  rowNumber: number,
  errors: ValidationError[]
): ParsedProductRow | null {
  const rowErrors: ValidationError[] = [];

  // Create row object
  const row: Record<string, unknown> = {};
  headers.forEach((header, index) => {
    row[header] = values[index] || '';
  });

  // Helper to safely get string value
  const getString = (key: string): string => String(row[key] || '');
  const getValue = (key: string): unknown => row[key];

  // Validate and parse name
  const name = getString('name');
  if (!name) {
    rowErrors.push({
      row: rowNumber,
      field: 'name',
      error: 'Name is required',
    });
  }

  // Validate and parse description
  const description = getString('description');
  if (!description) {
    rowErrors.push({
      row: rowNumber,
      field: 'description',
      error: 'Description is required',
    });
  }

  // Validate and parse price
  const price = parseFloat(getString('price'));
  if (isNaN(price) || price < 0) {
    rowErrors.push({
      row: rowNumber,
      field: 'price',
      error: `Price must be a valid positive number, got "${getValue('price')}"`,
      value: getValue('price'),
    });
  }

  // Validate category
  const category = getString('category');
  const validCategories = ['dresses', 'shoes', 'trousers', 'textiles'];
  if (!validCategories.includes(category)) {
    rowErrors.push({
      row: rowNumber,
      field: 'category',
      error: `Category must be one of: ${validCategories.join(', ')}, got "${category}"`,
      value: getValue('category'),
    });
  }

  // Validate SKU
  const sku = getString('sku');
  if (!sku) {
    rowErrors.push({
      row: rowNumber,
      field: 'sku',
      error: 'SKU is required',
    });
  }

  // Validate stock quantity
  const stockQuantity = parseInt(getString('stockquantity'), 10);
  if (isNaN(stockQuantity) || stockQuantity < 0) {
    rowErrors.push({
      row: rowNumber,
      field: 'stockQuantity',
      error: `Stock quantity must be a valid non-negative number, got "${getValue('stockquantity')}"`,
      value: getValue('stockquantity'),
    });
  }

  if (rowErrors.length > 0) {
    errors.push(...rowErrors);
    return null;
  }

  // Parse optional fields
  const sizesStr = getString('sizes');
  const sizes = sizesStr
    ? sizesStr
        .split(',')
        .map((s: string) => s.trim())
        .filter((s: string) => s)
    : [];

  const colorsStr = getString('colors');
  const colors = colorsStr
    ? colorsStr
        .split(',')
        .map((c: string) => c.trim())
        .filter((c: string) => c)
    : [];

  const featuredStr = getString('featured');
  const featured = featuredStr.toLowerCase() === 'true';

  const trendingStr = getString('trending');
  const trending = trendingStr.toLowerCase() === 'true';

  return {
    name,
    description,
    price,
    category: category as 'dresses' | 'shoes' | 'trousers' | 'textiles',
    images: [],
    sizes: sizes.length > 0 ? sizes : [''],
    colors: colors.length > 0 ? colors : [''],
    stockQuantity,
    sku,
    featured,
    trending,
  };
}

/**
 * Generate sample CSV content for documentation
 */
export function generateSampleCSV(): string {
  const headers = [
    'name',
    'description',
    'price',
    'category',
    'sku',
    'stockQuantity',
    'sizes',
    'colors',
    'featured',
    'trending',
  ];

  const sampleRows = [
    [
      'Summer Floral Dress',
      'Beautiful summer dress with floral pattern',
      '4999',
      'dresses',
      'DRESS-001',
      '50',
      '"XS,S,M,L,XL"',
      '"Red,Blue,Yellow"',
      'true',
      'false',
    ],
    [
      'Canvas Sneakers',
      'Comfortable everyday sneakers',
      '2999',
      'shoes',
      'SHOE-001',
      '100',
      '"6,7,8,9,10,11,12"',
      '"Black,White,Navy"',
      'false',
      'true',
    ],
    [
      'Black Trousers',
      'Professional black trousers',
      '3999',
      'trousers',
      'PANT-001',
      '75',
      '"XS,S,M,L,XL,XXL"',
      '"Black"',
      'false',
      'false',
    ],
  ];

  return [headers.join(','), ...sampleRows.map(row => row.join(','))].join('\n');
}

