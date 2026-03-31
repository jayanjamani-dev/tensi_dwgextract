"use client";

import { useState } from "react";

export default function SettingsPage() {
  const [threshold, setThreshold] = useState("0.7");
  const [saved, setSaved] = useState(false);

  function save(e: React.FormEvent) {
    e.preventDefault();
    // In this POC, settings are env vars — the threshold is informational here.
    // The actual CONFIDENCE_THRESHOLD is read from .env.local at runtime.
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-2">Settings</h1>
      <p className="text-sm text-gray-500 mb-6">
        API keys and runtime configuration. Edit <code className="bg-gray-100 px-1 rounded">.env.local</code> in the project root to change these values — the app must be restarted after changes.
      </p>

      <div className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col gap-5">
        {/* Gemini API Key */}
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Gemini API Key</label>
          <p className="text-xs text-gray-400 mb-2">Set <code className="bg-gray-100 px-1 rounded">GOOGLE_GEMINI_API_KEY</code> in <code className="bg-gray-100 px-1 rounded">.env.local</code></p>
          <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-400 bg-gray-50 font-mono">
            {process.env.GOOGLE_GEMINI_API_KEY ? "●●●●●●●●●●●●●●●● (set)" : "Not set"}
          </div>
        </div>

        {/* Model */}
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Gemini Model</label>
          <p className="text-xs text-gray-400 mb-2">Set <code className="bg-gray-100 px-1 rounded">GEMINI_MODEL</code> in <code className="bg-gray-100 px-1 rounded">.env.local</code></p>
          <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-500 bg-gray-50">
            gemini-2.5-flash (default)
          </div>
        </div>

        {/* Confidence threshold */}
        <form onSubmit={save}>
          <label className="text-sm font-medium text-gray-700 block mb-1">Confidence Threshold</label>
          <p className="text-xs text-gray-400 mb-2">
            Fields with confidence below this value are flagged LOW_CONFIDENCE. Set <code className="bg-gray-100 px-1 rounded">CONFIDENCE_THRESHOLD</code> in <code className="bg-gray-100 px-1 rounded">.env.local</code>
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            <button
              type="submit"
              className="text-sm bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700"
            >
              {saved ? "Saved ✓" : "Save"}
            </button>
          </div>
        </form>

        {/* Image fallback */}
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">Image Fallback Mode</label>
          <p className="text-xs text-gray-400 mb-2">
            When enabled, also sends a rendered page image to Gemini alongside the text. Disabled by default. Set <code className="bg-gray-100 px-1 rounded">ENABLE_IMAGE_FALLBACK=true</code> in <code className="bg-gray-100 px-1 rounded">.env.local</code>
          </p>
          <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-500 bg-gray-50">
            Currently: disabled (false)
          </div>
        </div>

        {/* pdfplumber check */}
        <div className="border-t border-gray-100 pt-4">
          <label className="text-sm font-medium text-gray-700 block mb-1">System Requirements</label>
          <div className="text-xs text-gray-500 space-y-1">
            <div>• Python 3 + pdfplumber — required for text extraction</div>
            <div>• Run <code className="bg-gray-100 px-1 rounded">pip install pdfplumber</code> if not installed</div>
            <div>• Gemini API key — required for AI extraction</div>
          </div>
        </div>
      </div>
    </div>
  );
}
