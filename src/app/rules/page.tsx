import Link from "next/link";

export default function RulesPage() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-2 text-gray-900">System Business Rules</h1>
        <p className="text-gray-500 text-sm">
          A living reference for all extraction, validation, learning, and UI rules governing the Tensi Drawing Extraction system.
        </p>
      </div>

      <div className="prose prose-sm max-w-none text-gray-800">
        <table className="min-w-full text-left border-collapse border border-gray-200 shadow-sm rounded-lg bg-white overflow-hidden">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider border-r w-12 text-center">#</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider border-r w-48">Area</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Rule</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr className="hover:bg-gray-50">
              <td className="px-4 py-3 border-r text-center align-top font-medium text-gray-500">1</td>
              <td className="px-4 py-3 border-r align-top font-medium">Data Extraction</td>
              <td className="px-4 py-3 align-top">
                <strong>Status Extraction Focus:</strong> The system must always search and parse the revision block first. The status is derived from the most recent/highest chronological entry. Main title block status is only used if the revision block is empty or missing. Title block status acts strictly as a fallback.
              </td>
            </tr>
            <tr className="hover:bg-gray-50">
              <td className="px-4 py-3 border-r text-center align-top font-medium text-gray-500">2</td>
              <td className="px-4 py-3 border-r align-top font-medium">Data Extraction</td>
              <td className="px-4 py-3 align-top">
                <strong>Revision Discrepancy:</strong> If a drawing's title block revision identifier contradicts the most recent revision block entry, the revision block always takes ultimate priority.
              </td>
            </tr>
            <tr className="hover:bg-gray-50">
              <td className="px-4 py-3 border-r text-center align-top font-medium text-gray-500">3</td>
              <td className="px-4 py-3 border-r align-top font-medium">Data Normalisation</td>
              <td className="px-4 py-3 align-top">
                <strong>Strict Date Enforcement:</strong> All revision dates are strictly extracted and standardised to <code className="bg-gray-100 px-1 py-0.5 rounded text-fuchsia-700">DD/MM/YYYY</code> format. Any extracted date string failing this standard is suppressed to null.
              </td>
            </tr>
            <tr className="hover:bg-gray-50">
              <td className="px-4 py-3 border-r text-center align-top font-medium text-gray-500">4</td>
              <td className="px-4 py-3 border-r align-top font-medium">Data Normalisation</td>
              <td className="px-4 py-3 align-top">
                <strong>Terminology Canonicalisation:</strong> Raw labels extracted by OCR are fed through a dynamic terminology dictionary mapping variations (e.g., 'Rev', 'Issue') to specific canonical groups.
              </td>
            </tr>
            <tr className="hover:bg-gray-50">
              <td className="px-4 py-3 border-r text-center align-top font-medium text-gray-500">5</td>
              <td className="px-4 py-3 border-r align-top font-medium">Architect Templates</td>
              <td className="px-4 py-3 align-top">
                <strong>Bounding Box Memory:</strong> Title block coordinates and specific field locations are dynamically averaged and locked into an Architect Template after exactly 2 successful extractions from the same firm.
              </td>
            </tr>
            <tr className="hover:bg-gray-50">
              <td className="px-4 py-3 border-r text-center align-top font-medium text-gray-500">6</td>
              <td className="px-4 py-3 border-r align-top font-medium">Architect Templates</td>
              <td className="px-4 py-3 align-top">
                <strong>Smart Cropping Fallback:</strong> After locking an architect's template pattern, subsequent extractions bypass full-page scanning completely and instead crop the document identically, validating pattern parity against known values. Mismatches instigate full scans.
              </td>
            </tr>
            <tr className="hover:bg-gray-50">
              <td className="px-4 py-3 border-r text-center align-top font-medium text-gray-500">7</td>
              <td className="px-4 py-3 border-r align-top font-medium">Continuous Learning</td>
              <td className="px-4 py-3 align-top">
                <strong>Global Correction Intelligence:</strong> When a user corrects a field manually (e.g., changing 'R0' to '0'), this action is permanently logged into the Architect's template. Future extractions inject these mappings directly into the LLM context to prevent repeated mistakes dynamically.
              </td>
            </tr>
            <tr className="hover:bg-gray-50">
              <td className="px-4 py-3 border-r text-center align-top font-medium text-gray-500">8</td>
              <td className="px-4 py-3 border-r align-top font-medium">UI & Bulk Actions</td>
              <td className="px-4 py-3 align-top">
                <strong>Auto-Detect Project Errata:</strong> Any user correction instantly triggers a project-wide scan for similar identical field errors, prompting the user for approval to bulk-correct the rest of the set simultaneously.
              </td>
            </tr>
            <tr className="hover:bg-gray-50">
              <td className="px-4 py-3 border-r text-center align-top font-medium text-gray-500">9</td>
              <td className="px-4 py-3 border-r align-top font-medium">UI & Workflow</td>
              <td className="px-4 py-3 align-top">
                <strong>Non-Destructive Immediate Viewing:</strong> Opening a drawing document launches an inline 85vw slide-over PDF viewer showcasing extracted coordinates actively colored against an un-scrolled PDF to reduce user cognitive load.
              </td>
            </tr>
            <tr className="hover:bg-gray-50">
              <td className="px-4 py-3 border-r text-center align-top font-medium text-gray-500">10</td>
              <td className="px-4 py-3 border-r align-top font-medium">Data Deletion</td>
              <td className="px-4 py-3 align-top">
                <strong>Immediate Destructive Removal:</strong> Users deleting projects or batch drawings bypass undo confirmation prompts entirely via immediate destructive cascading filesystem and row removal.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
