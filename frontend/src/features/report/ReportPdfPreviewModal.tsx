import React, { useState, useEffect } from 'react';
import { EyeIcon, XIcon, DownloadIcon, FileIcon } from '../../icons';
import { loadReportData } from './reportData';
import { generateInspectionPdf, type PdfProgressEvent } from './pdf';
import './ReportPdfPreviewModal.css';

export interface ReportPdfPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  inspectionId: string;
  vesselName?: string;
  defaultReportType?: 'photo_only' | 'full' | 'observation';
}

export function ReportPdfPreviewModal({
  isOpen,
  onClose,
  inspectionId,
  vesselName,
  defaultReportType = 'photo_only',
}: ReportPdfPreviewModalProps) {
  const [reportType, setReportType] = useState<'photo_only' | 'full' | 'observation'>(defaultReportType);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressInfo, setProgressInfo] = useState<PdfProgressEvent | null>(null);

  // Generate PDF whenever modal opens or report type changes
  useEffect(() => {
    if (!isOpen || !inspectionId) return;

    let isCancelled = false;
    let createdUrl: string | null = null;

    async function buildPdf() {
      setIsGenerating(true);
      setError(null);
      setProgressInfo(null);
      try {
        const rep = await loadReportData(inspectionId);
        if (!rep) {
          throw new Error('Inspection survey data could not be loaded.');
        }

        const blob = await generateInspectionPdf({
          ...rep,
          reportType,
          onProgress: (p) => {
            if (!isCancelled) setProgressInfo(p);
          },
        });

        if (!isCancelled) {
          createdUrl = URL.createObjectURL(blob);
          setPdfUrl(createdUrl);
        }
      } catch (err: any) {
        if (!isCancelled) {
          console.error('Failed to generate report PDF for preview', err);
          setError(err.message || 'Failed to render PDF preview.');
        }
      } finally {
        if (!isCancelled) {
          setIsGenerating(false);
        }
      }
    }

    void buildPdf();

    return () => {
      isCancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [isOpen, inspectionId, reportType]);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleDownload = () => {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    const slug = (vesselName || 'inspection').replace(/[^a-z0-9]+/gi, '-');
    a.download = `${slug}-${reportType === 'photo_only' ? 'photo-section-report' : reportType === 'observation' ? 'observation-report' : 'full-audit-report'}.pdf`;
    a.click();
  };

  const handleOpenNewTab = () => {
    if (!pdfUrl) return;
    window.open(pdfUrl, '_blank');
  };

  return (
    <div className="rppm-backdrop" onClick={onClose}>
      <div className="rppm-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Top Header ── */}
        <div className="rppm-header">
          <div className="rppm-header-left">
            <div className="rppm-header-icon">
              <FileIcon width={22} height={22} />
            </div>
            <div className="rppm-header-text">
              <div className="rppm-title-row">
                <h3 className="rppm-title">Official Report Preview</h3>
                <span className="rppm-type-badge">
                  {reportType === 'photo_only' ? 'Photo Section Survey' : reportType === 'observation' ? 'Observation Report' : 'Full Audit Survey'}
                </span>
                {vesselName && <span className="rppm-vessel-badge">{vesselName}</span>}
              </div>
              <p className="rppm-subtitle">
                Live statutory report document review • Exact fidelity as exported PDF
              </p>
            </div>
          </div>

          <div className="rppm-header-actions">
            {/* Report Type Selector */}
            <div className="rppm-type-toggle">
              <button
                type="button"
                className={`rppm-toggle-btn ${reportType === 'photo_only' ? 'active' : ''}`}
                onClick={() => setReportType('photo_only')}
                disabled={isGenerating}
              >
                Photo Report
              </button>
              <button
                type="button"
                className={`rppm-toggle-btn ${reportType === 'full' ? 'active' : ''}`}
                onClick={() => setReportType('full')}
                disabled={isGenerating}
              >
                Full Checklist
              </button>
              <button
                type="button"
                className={`rppm-toggle-btn ${reportType === 'observation' ? 'active' : ''}`}
                onClick={() => setReportType('observation')}
                disabled={isGenerating}
              >
                Observation Report
              </button>
            </div>

            {pdfUrl && (
              <>
                <button
                  type="button"
                  className="btn btn-outline btn-sm rppm-action-btn"
                  onClick={handleOpenNewTab}
                  title="Open report in separate tab"
                >
                  <EyeIcon width={14} height={14} />
                  <span>New Tab</span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm rppm-action-btn"
                  onClick={handleDownload}
                  title="Download report PDF"
                >
                  <DownloadIcon width={14} height={14} />
                  <span>Download PDF</span>
                </button>
              </>
            )}

            <button
              type="button"
              className="rppm-close-btn"
              onClick={onClose}
              title="Close Report Review (Esc)"
              aria-label="Close"
            >
              <XIcon width={18} height={18} />
            </button>
          </div>
        </div>

        {/* ── Document Body ── */}
        <div className="rppm-body">
          {isGenerating ? (
            <div className="rppm-loading">
              <div className="rppm-spinner" />
              <h4 className="rppm-loading-title">Generating Report PDF…</h4>
              <p className="rppm-loading-sub">
                {progressInfo?.stage || 'Compiling photographic evidence, surveyor remarks, and statutory particulars.'}
              </p>
              {progressInfo && progressInfo.total > 0 && (
                <div className="rppm-progress-wrapper">
                  <div className="rppm-progress-bar-container">
                    <div
                      className="rppm-progress-bar-fill"
                      style={{ width: `${progressInfo.percent}%` }}
                    />
                  </div>
                  <span className="rppm-progress-text">
                    {progressInfo.loaded} of {progressInfo.total} photos processed ({progressInfo.percent}%)
                  </span>
                </div>
              )}
            </div>
          ) : error ? (
            <div className="rppm-error">
              <h4>Failed to Generate Preview</h4>
              <p>{error}</p>
            </div>
          ) : pdfUrl ? (
            <iframe
              src={`${pdfUrl}#toolbar=1&navpanes=1`}
              className="rppm-iframe"
              title="Report PDF Document Viewer"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
