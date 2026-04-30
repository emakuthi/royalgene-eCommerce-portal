'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

type Product = { name: string; sales: number; quantity: number };

export default function TopProducts({ products }: { products?: Product[] }) {
  return (
    <Card>
      <CardContent>
        <h3 className="font-semibold">Top Performing Products</h3>
        <div className="mt-4 space-y-3 text-sm">
          {!products || products.length === 0 ? (
            <div className="text-sm text-gray-500">No top products yet.</div>
          ) : (
            products.map((p, i) => (
              <div key={p.name} className={`flex items-center justify-between p-2 rounded ${i === 0 ? 'bg-gray-50 dark:bg-gray-800' : ''}`}>
                <div>
                  <div className="text-xs text-gray-500">#{i + 1}</div>
                  <div className="font-medium">{p.name}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">KES {p.sales.toLocaleString()}</div>
                  <div className="text-xs text-green-600">{p.quantity} sold</div>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

