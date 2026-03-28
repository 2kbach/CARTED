"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { signOut } from "next-auth/react";
import ProductDetailModal from "./product-detail-modal";

interface ShoppingItem {
  id: string;
  name: string;
  productUrl: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  completedByOrderId: string | null;
  amazonOrderItemId: string | null;
  createdAt: string;
  addedBy: {
    name: string | null;
    email: string;
    image: string | null;
  };
}

interface SearchSuggestion {
  name: string;
  productUrl: string | null;
  imageUrl: string | null;
  lastPrice: number | null;
  lastOrderDate: string;
  purchaseCount: number;
}

interface User {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

export default function DashboardClient({ user }: { user: User }) {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadItems = useCallback(async () => {
    const res = await fetch("/api/shopping-list");
    if (res.ok) {
      const data = await res.json();
      setItems(data.items);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const searchProducts = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const res = await fetch(`/api/orders/search?q=${encodeURIComponent(q)}`);
    if (res.ok) {
      const data = await res.json();
      setSuggestions(data.items);
    }
  }, []);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => searchProducts(value), 300);
    setShowSuggestions(true);
  };

  const addItem = async (name: string, productUrl?: string | null) => {
    const res = await fetch("/api/shopping-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, productUrl }),
    });
    if (res.ok) {
      setSearchQuery("");
      setSuggestions([]);
      setShowSuggestions(false);
      loadItems();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      addItem(searchQuery.trim());
    }
  };

  const selectSuggestion = (suggestion: SearchSuggestion) => {
    addItem(suggestion.name, suggestion.productUrl);
  };

  const toggleItem = async (id: string, isCompleted: boolean) => {
    await fetch(`/api/shopping-list/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isCompleted: !isCompleted }),
    });
    loadItems();
  };

  const deleteItem = async (id: string) => {
    await fetch(`/api/shopping-list/${id}`, { method: "DELETE" });
    loadItems();
  };

  const deleteCompletedItem = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    await fetch(`/api/shopping-list/${id}`, { method: "DELETE" });
    loadItems();
  };

  const deleteAllCompleted = async () => {
    if (!window.confirm(`Delete all ${completed.length} completed items?`)) return;
    await Promise.all(completed.map((item) => fetch(`/api/shopping-list/${item.id}`, { method: "DELETE" })));
    loadItems();
  };

  const runScan = async (initial: boolean = false) => {
    setIsScanning(true);
    setScanResult(null);
    try {
      const endpoint = initial ? "/api/scan/initial" : "/api/scan";
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setScanResult(
          `Found ${data.emailsFound} emails, ${data.created} new orders, ${data.itemsCreated} items${data.autoCompleted ? `, ${data.autoCompleted} auto-completed` : ""}`
        );
        loadItems();
      } else {
        setScanResult(`Error: ${data.error}`);
      }
    } catch {
      setScanResult("Scan failed");
    }
    setIsScanning(false);
  };

  const getAmazonLink = (url: string) => {
    // On iOS, try Amazon app deep link
    const isIOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (isIOS) {
      try {
        const u = new URL(url);
        return `amazon://${u.pathname}`;
      } catch {
        return url;
      }
    }
    return url;
  };

  const uncompleted = items.filter((i) => !i.isCompleted);
  const completed = items.filter((i) => i.isCompleted);

  return (
    <div className="max-w-lg mx-auto p-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">CARTED</h1>
        <div className="flex items-center gap-2">
          {user.image && (
            <img
              src={user.image}
              alt=""
              className="w-8 h-8 rounded-full"
            />
          )}
          <button
            onClick={() => signOut()}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Scan Controls */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => runScan(false)}
          disabled={isScanning}
          className="text-sm px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
        >
          {isScanning ? "Scanning..." : "Sync Last 30 Days"}
        </button>
        <button
          onClick={() => runScan(true)}
          disabled={isScanning}
          className="text-sm px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
        >
          Full Scan (10yr)
        </button>
      </div>

      {scanResult && (
        <div className="text-sm text-gray-600 bg-gray-50 p-2 rounded-lg mb-4">
          {scanResult}
        </div>
      )}

      {/* Add Item Input */}
      <form onSubmit={handleSubmit} className="relative mb-6">
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          placeholder="Add an item (e.g., Deodorant)"
          className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-base focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
        />
        {searchQuery && (
          <button
            type="submit"
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black text-white px-4 py-1.5 rounded-lg text-sm font-medium"
          >
            Add
          </button>
        )}

        {/* Suggestions Dropdown */}
        {showSuggestions && searchQuery.length >= 2 && suggestions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-[400px] overflow-y-auto">
            {suggestions.map((s, i) => (
              <button
                key={`order-${i}`}
                type="button"
                onMouseDown={() => selectSuggestion(s)}
                className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center justify-between border-b border-gray-50 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{s.name}</div>
                  <div className="text-xs text-gray-400">
                    Ordered {s.purchaseCount}x
                    {s.lastPrice && ` \u00B7 $${(s.lastPrice / 100).toFixed(2)}`}
                  </div>
                </div>
                {s.imageUrl && (
                  <img src={s.imageUrl} alt="" className="w-10 h-10 object-contain rounded flex-shrink-0 ml-2" />
                )}
              </button>
            ))}
          </div>
        )}
      </form>

      {/* Shopping List */}
      <div className="space-y-2">
        {uncompleted.length === 0 && completed.length === 0 && (
          <p className="text-center text-gray-400 py-8">
            No items yet. Start by adding something above!
          </p>
        )}

        {uncompleted.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100 overflow-hidden"
          >
            <button
              onClick={() => toggleItem(item.id, item.isCompleted)}
              className="w-6 h-6 rounded-full border-2 border-gray-300 flex-shrink-0 hover:border-black transition-colors"
            />
            <div className="flex-1 min-w-0 overflow-hidden">
              <button
                onClick={() => setSelectedProduct(item.name)}
                className="font-medium text-sm w-full text-left hover:underline truncate block"
              >
                {item.name}
              </button>
              <div className="flex items-center gap-1.5 mt-0.5">
                {item.addedBy.image && (
                  <img src={item.addedBy.image} alt="" className="w-4 h-4 rounded-full" />
                )}
                <span className="text-xs text-gray-400">
                  {item.addedBy.name?.split(" ")[0]}
                </span>
                <span className="text-xs text-gray-300">·</span>
                {item.productUrl ? (
                  <a
                    href={getAmazonLink(item.productUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-blue-500 hover:underline"
                  >
                    View on Amazon
                  </a>
                ) : (
                  <a
                    href={`https://www.amazon.com/s?k=${encodeURIComponent(item.name)}&tag=2kbach-20`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-orange-500 hover:underline"
                  >
                    Search on Amazon
                  </a>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => deleteItem(item.id)}
                className="text-gray-300 hover:text-red-400"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Completed Section */}
      {completed.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setShowCompleted(!showCompleted)}
              className="text-sm text-gray-400 font-medium flex items-center gap-1"
            >
              <svg
                className={`w-4 h-4 transition-transform ${showCompleted ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Completed ({completed.length})
            </button>
            {showCompleted && (
              <button
                onClick={deleteAllCompleted}
                className="text-xs text-blue-400 hover:text-blue-600"
              >
                Delete all
              </button>
            )}
          </div>

          {showCompleted && (
            <div className="space-y-2">
              {completed.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100 opacity-60"
                >
                  <button
                    onClick={() => toggleItem(item.id, item.isCompleted)}
                    className="w-6 h-6 rounded-full bg-green-500 flex-shrink-0 flex items-center justify-center"
                  >
                    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm line-through text-gray-500 truncate block">
                      {item.name}
                    </span>
                    <div className="flex items-center gap-1 mt-0.5">
                      {item.addedBy.image && (
                        <img src={item.addedBy.image} alt="" className="w-4 h-4 rounded-full" />
                      )}
                      <span className="text-xs text-gray-400">
                        {item.addedBy.name?.split(" ")[0]}
                        {item.completedByOrderId && " \u00B7 Auto-completed"}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteCompletedItem(item.id, item.name)}
                    className="text-gray-300 hover:text-red-400 flex-shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Product Detail Modal */}
      {selectedProduct && (
        <ProductDetailModal
          productName={selectedProduct}
          onClose={() => setSelectedProduct(null)}
        />
      )}

      {/* Version */}
      <p className="text-center text-xs text-gray-300 mt-8">v1.1.1</p>
    </div>
  );
}
