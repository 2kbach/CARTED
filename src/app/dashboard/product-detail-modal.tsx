"use client";

import { useState, useEffect } from "react";

interface HistoryEntry {
  name: string;
  price: number | null;
  quantity: number;
  productUrl: string | null;
  orderDate: string;
  orderNumber: string | null;
}

export default function ProductDetailModal({
  productName,
  onClose,
}: {
  productName: string;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      const res = await fetch(
        `/api/orders/${encodeURIComponent(productName)}/history`
      );
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history);
      }
      setLoading(false);
    }
    loadHistory();
  }, [productName]);

  const pricesWithDates = history
    .filter((h) => h.price !== null)
    .map((h) => ({
      price: h.price!,
      date: new Date(h.orderDate),
    }));

  const minPrice = pricesWithDates.length
    ? Math.min(...pricesWithDates.map((p) => p.price))
    : 0;
  const maxPrice = pricesWithDates.length
    ? Math.max(...pricesWithDates.map((p) => p.price))
    : 0;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-6 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Purchase History</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-gray-500 mb-4 truncate">{productName}</p>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading...</div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            No purchase history found
          </div>
        ) : (
          <>
            {/* Price Summary */}
            {pricesWithDates.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-400">Low</div>
                  <div className="font-bold text-green-600">
                    ${(minPrice / 100).toFixed(2)}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-400">High</div>
                  <div className="font-bold text-red-500">
                    ${(maxPrice / 100).toFixed(2)}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-400">Orders</div>
                  <div className="font-bold">{history.length}</div>
                </div>
              </div>
            )}

            {/* Simple Price Chart */}
            {pricesWithDates.length > 1 && (
              <div className="mb-4 bg-gray-50 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-2">Price Over Time</div>
                <div className="h-24 flex items-end gap-1">
                  {pricesWithDates.map((p, i) => {
                    const range = maxPrice - minPrice || 1;
                    const height = ((p.price - minPrice) / range) * 80 + 20;
                    return (
                      <div
                        key={i}
                        className="flex-1 bg-blue-400 rounded-t"
                        style={{ height: `${height}%` }}
                        title={`$${(p.price / 100).toFixed(2)} - ${p.date.toLocaleDateString()}`}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* History List */}
            <div className="space-y-2">
              {history.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0"
                >
                  <div>
                    <div className="text-sm">
                      {new Date(entry.orderDate).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                    <div className="text-xs text-gray-400">
                      Qty: {entry.quantity}
                      {entry.orderNumber && ` \u00B7 #${entry.orderNumber}`}
                    </div>
                  </div>
                  <div className="text-right">
                    {entry.price !== null && (
                      <div className="font-medium">
                        ${(entry.price / 100).toFixed(2)}
                      </div>
                    )}
                    {entry.productUrl && (
                      <a
                        href={entry.productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-orange-500 hover:underline"
                      >
                        View on Amazon
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
