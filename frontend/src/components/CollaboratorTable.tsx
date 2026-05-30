"use client";

import { useState } from "react";

export interface Collaborator {
  address: string;
  basisPoints: number; // 100 = 1%
}

interface Props {
  collaborators: Collaborator[];
}

import styles from './CollaboratorTable.module.css';

export default function CollaboratorTable({ collaborators }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
