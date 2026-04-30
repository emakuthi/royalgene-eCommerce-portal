'use client';

import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

export function Sidebar() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const menuItems = [
    { href: '/', label: 'Home' },
    { href: '/products', label: 'All Products' },
    { href: '/products?category=dresses', label: 'Dresses' },
    { href: '/products?category=shoes', label: 'Shoes' },
    { href: '/products?category=trousers', label: 'Trousers' },
    { href: '/products?category=textiles', label: 'Textiles' },
  ];

  return (
    <>
      {/* Desktop Sidebar - Hidden on mobile, shown on md+ */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:border-r md:bg-muted/40">
        <nav className="flex-1 space-y-1 px-2 py-4">
          {menuItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Mobile Sidebar Toggle and Overlay */}
      <div className="md:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="fixed bottom-4 right-4 z-50"
        >
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>

        {sidebarOpen && (
          <div className="fixed inset-0 z-30 top-16">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setSidebarOpen(false)}
            />
            <aside className="absolute left-0 top-0 h-screen w-64 border-r bg-background shadow-lg">
              <nav className="space-y-1 px-2 py-4">
                {menuItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
                    onClick={() => setSidebarOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </aside>
          </div>
        )}
      </div>
    </>
  );
}

