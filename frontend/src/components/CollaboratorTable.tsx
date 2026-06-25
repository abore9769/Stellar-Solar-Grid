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

export default function CollaboratorTable({ collaborators, onAdd, onRemove }: Props) {
  const { showToast } = useToast();
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

  function isValidStellarAddress(addr: string): boolean {
    return /^G[A-Z2-7]{55}$/.test(addr);
  }

  async function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanAddress = newAddress.trim();
    const bp = parseInt(newBasisPoints, 10);

    if (!cleanAddress) {
      showToast({
        variant: "error",
        title: "Validation Error",
        description: "Address is required.",
      });
      return;
    }

    if (!isValidStellarAddress(cleanAddress)) {
      showToast({
        variant: "error",
        title: "Validation Error",
        description: "Invalid Stellar address. Must start with G and be 56 characters.",
      });
      return;
    }

    if (isNaN(bp) || bp <= 0 || bp > 10000) {
      showToast({
        variant: "error",
        title: "Validation Error",
        description: "Basis points must be a number between 1 and 10000 (100 = 1%).",
      });
      return;
    }

    const currentTotal = collaborators.reduce((acc, c) => acc + c.basisPoints, 0);
    if (currentTotal + bp > 10000) {
      showToast({
        variant: "error",
        title: "Validation Error",
        description: `Cannot add share. Total shares would exceed 100% (${(currentTotal + bp) / 100}%).`,
      });
      return;
    }

    if (collaborators.some((c) => c.address.toLowerCase() === cleanAddress.toLowerCase())) {
      showToast({
        variant: "error",
        title: "Validation Error",
        description: "Collaborator address is already added.",
      });
      return;
    }

    setIsAdding(true);
    try {
      await onAdd(cleanAddress, bp);
      setNewAddress("");
      setNewBasisPoints("");
    } catch (err) {
      // Error handling is managed by parent dashboard toast, but we stop loading state
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemove(address: string) {
    setIsRemoving(address);
    try {
      await onRemove(address);
    } catch (err) {
      // Error handling is managed by parent dashboard toast
    } finally {
      setIsRemoving(null);
    }
  }

  return (
    <div className="card overflow-x-auto">
      <span className="badge">Collaborators</span>
      <table className="collab-table">
        <thead>
          <tr>
            <th>Address</th>
            <th>Share</th>
            <th style={{ textAlign: "right" }}>Actions</th>
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
              <td>
                <span className="share-label">
                  {(c.basisPoints / 100).toFixed(2)}% ({c.basisPoints} bp)
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
