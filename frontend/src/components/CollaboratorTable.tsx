"use client";

import { useState } from "react";
import { useToast } from "@/components/ToastProvider";

export interface Collaborator {
  address: string;
  basisPoints: number; // 100 = 1%
}

interface Props {
  collaborators: Collaborator[];
  onAdd: (address: string, basisPoints: number) => Promise<void>;
  onRemove: (address: string) => Promise<void>;
}

import styles from './CollaboratorTable.module.css';

export default function CollaboratorTable({ collaborators }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState("");
  const [newBasisPoints, setNewBasisPoints] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isRemoving, setIsRemoving] = useState<string | null>(null);

  function copyAddress(address: string) {
    navigator.clipboard.writeText(address);
    setCopied(address);
    setTimeout(() => setCopied(null), 1500);
  }

  // Empty state — helpful message instead of silent null
  if (!collaborators.length) {
    return (
      <div className="card">
        <span className="badge">Collaborators</span>
        <p className={`text-sm mt-2 ${styles.emptyMessage}`}>
          No collaborators found. Initialize the contract to add collaborators.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <span className="badge">Collaborators</span>
      <table className="collab-table">
        <thead>
          <tr>
            <th>Address</th>
            <th className="text-right">Share</th>
          </tr>
        </thead>
        <tbody>
          {collaborators.length === 0 && (
            <tr>
              <td colSpan={3} className="text-center text-xs text-gray-500 py-6">
                No revenue collaborators configured yet.
              </td>
            </tr>
          )}

          {collaborators.map((c) => (
            <tr key={c.address}>
              {/* Truncated address with full-address tooltip + copy button */}
              <td>
                <div className="address-cell">
                  <span title={c.address} className="address-truncated">
                    {c.address.slice(0, 8)}...{c.address.slice(-6)}
                  </span>
                  <button
                    className="copy-btn-sm"
                    onClick={() => copyAddress(c.address)}
                    title="Copy address"
                  >
                    {copied === c.address ? "✓" : "⧉"}
                  </button>
                </div>
              </td>

              {/* Share bar with visible percentage label */}
              <td className={styles.shareCell}>
                <span className={styles.shareLabel}>
                  {(c.basisPoints / 100).toFixed(2)}%
                </span>
                <div
                  className="share-bar"
                  style={{ width: `${c.basisPoints / 100}%` }}
                  role="meter"
                  aria-valuenow={c.basisPoints / 100}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${(c.basisPoints / 100).toFixed(2)}% share`}
                />
              </td>

              {/* Remove Action Button */}
              <td style={{ textAlign: "right" }}>
                <button
                  onClick={() => handleRemove(c.address)}
                  disabled={isRemoving !== null || isAdding}
                  className="text-red-400 hover:text-red-300 disabled:opacity-40 text-xs px-2.5 py-1 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition"
                >
                  {isRemoving === c.address ? "Removing..." : "Remove"}
                </button>
              </td>
            </tr>
          ))}

          {/* Inline Add Collaborator Form Row */}
          <tr>
            <td className="pt-4">
              <input
                type="text"
                placeholder="Stellar Address (G...)"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                disabled={isAdding || isRemoving !== null}
                className="w-full bg-solar-dark border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-solar-yellow transition"
              />
            </td>
            <td className="pt-4">
              <input
                type="number"
                placeholder="Basis points (100 = 1%)"
                value={newBasisPoints}
                onChange={(e) => setNewBasisPoints(e.target.value)}
                disabled={isAdding || isRemoving !== null}
                className="w-full bg-solar-dark border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-solar-yellow transition"
              />
            </td>
            <td className="pt-4" style={{ textAlign: "right" }}>
              <button
                onClick={handleAddSubmit}
                disabled={isAdding || isRemoving !== null}
                className="bg-solar-yellow text-solar-dark text-xs font-semibold px-4 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 transition"
              >
                {isAdding ? "Adding..." : "Add"}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
