/** @jsxImportSource react */
import type { ReactNode } from "react";

/**
 * Shared email theme constants matching the CalibraFacil design system
 */
export const theme = {
  colors: {
    background: "#f1f5f9", // slate-100
    surface: "#ffffff",
    primary: "#1e3a8a", // blue-900
    primaryText: "#1e293b", // slate-800
    secondaryText: "#64748b", // slate-500
    border: "#e2e8f0", // slate-200
    codeBg: "#f8fafc", // slate-50
    codeText: "#1d4ed8", // blue-700
    buttonBg: "#1e3a8a",
    buttonText: "#ffffff",
    successBg: "#dcfce7",
    successBorder: "#86efac",
    successText: "#166534",
    warningBg: "#fef3c7",
    warningBorder: "#fcd34d",
    warningText: "#92400e",
    errorBg: "#fee2e2",
    errorBorder: "#fca5a5",
    errorText: "#991b1b",
    infoBg: "#dbeafe",
    infoBorder: "#93c5fd",
    infoText: "#1e40af",
  },
  fontFamily: {
    sans: "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    mono: "'Roboto Mono', 'Courier New', Courier, monospace",
  },
} as const;

/**
 * Common inline styles for email components
 */
export const styles = {
  wrapper: {
    fontFamily: theme.fontFamily.sans,
    backgroundColor: theme.colors.background,
    padding: "40px 20px",
    width: "100%",
    minHeight: "100%",
    boxSizing: "border-box" as const,
  },
  container: {
    maxWidth: "500px",
    margin: "0 auto",
    backgroundColor: theme.colors.surface,
    borderRadius: "16px",
    border: `1px solid ${theme.colors.border}`,
    overflow: "hidden" as const,
    boxShadow:
      "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
  },
  header: {
    backgroundColor: theme.colors.primary,
    padding: "24px",
    textAlign: "center" as const,
  },
  headerText: {
    color: "#ffffff",
    fontSize: "20px",
    fontWeight: "700",
    letterSpacing: "-0.025em",
  },
  body: {
    padding: "40px 32px",
    textAlign: "center" as const,
  },
  title: {
    color: theme.colors.primaryText,
    fontSize: "24px",
    fontWeight: "700",
    margin: "0 0 12px",
    lineHeight: "1.2",
  },
  paragraph: {
    color: theme.colors.secondaryText,
    fontSize: "15px",
    lineHeight: "1.6",
    margin: "0 0 24px",
  },
  button: {
    display: "inline-block",
    backgroundColor: theme.colors.buttonBg,
    color: theme.colors.buttonText,
    padding: "16px 32px",
    borderRadius: "8px",
    textDecoration: "none",
    fontSize: "16px",
    fontWeight: "600",
  },
  footer: {
    backgroundColor: "#f8fafc",
    borderTop: `1px solid ${theme.colors.border}`,
    padding: "24px 32px",
    textAlign: "center" as const,
  },
  footerText: {
    fontSize: "11px",
    color: "#94a3b8",
    margin: "0 0 12px",
  },
  externalNote: {
    maxWidth: "500px",
    margin: "24px auto 0",
    textAlign: "center" as const,
  },
  externalNoteText: {
    fontSize: "12px",
    color: "#cbd5e1",
  },
  link: {
    color: theme.colors.codeText,
    textDecoration: "none",
  },
  highlightBox: {
    backgroundColor: theme.colors.codeBg,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: "8px",
    padding: "24px",
    marginBottom: "32px",
  },
  highlightLabel: {
    display: "block",
    textTransform: "uppercase" as const,
    fontSize: "12px",
    color: theme.colors.secondaryText,
    fontWeight: "600",
    letterSpacing: "0.05em",
    marginBottom: "8px",
  },
  highlightValue: {
    fontFamily: theme.fontFamily.mono,
    fontSize: "20px",
    fontWeight: "700",
    color: theme.colors.codeText,
    letterSpacing: "2px",
    lineHeight: "1",
  },
} as const;

interface EmailLayoutProps {
  previewText: string;
  children: ReactNode;
  footerNote?: string;
}

/**
 * Shared email layout wrapper component
 * Provides consistent header, container, and footer across all email templates
 */
export function EmailLayout({
  previewText,
  children,
  footerNote,
}: EmailLayoutProps) {
  return (
    <div style={styles.wrapper}>
      {/* Hidden preview text for email clients */}
      <div
        style={{
          display: "none",
          fontSize: "1px",
          lineHeight: "1px",
          maxHeight: "0px",
          maxWidth: "0px",
          opacity: 0,
          overflow: "hidden",
        }}
      >
        {previewText}
      </div>

      <div style={styles.container}>
        {/* Header with brand */}
        <div style={styles.header}>
          <span style={styles.headerText}>CalibraFacil</span>
        </div>

        {/* Content body */}
        {children}

        {/* Footer */}
        <div style={styles.footer}>
          <p style={styles.footerText}>
            &copy; {new Date().getFullYear()} CalibraFacil - Gestao de
            Calibracao.
          </p>
          <p style={{ ...styles.footerText, margin: "0" }}>
            Todos os direitos reservados.
          </p>
        </div>
      </div>

      {/* External note below card */}
      {footerNote && (
        <div style={styles.externalNote}>
          <p style={styles.externalNoteText}>{footerNote}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Status box component with color variants
 */
interface StatusBoxProps {
  variant: "success" | "warning" | "error" | "info";
  children: ReactNode;
}

export function StatusBox({ variant, children }: StatusBoxProps) {
  const variantStyles = {
    success: {
      backgroundColor: theme.colors.successBg,
      border: `1px solid ${theme.colors.successBorder}`,
      color: theme.colors.successText,
    },
    warning: {
      backgroundColor: theme.colors.warningBg,
      border: `1px solid ${theme.colors.warningBorder}`,
      color: theme.colors.warningText,
    },
    error: {
      backgroundColor: theme.colors.errorBg,
      border: `1px solid ${theme.colors.errorBorder}`,
      color: theme.colors.errorText,
    },
    info: {
      backgroundColor: theme.colors.infoBg,
      border: `1px solid ${theme.colors.infoBorder}`,
      color: theme.colors.infoText,
    },
  };

  return (
    <div
      style={{
        ...variantStyles[variant],
        borderRadius: "8px",
        padding: "16px",
        marginBottom: "24px",
      }}
    >
      <p
        style={{
          fontSize: "14px",
          color: variantStyles[variant].color,
          margin: "0",
          lineHeight: "1.5",
        }}
      >
        {children}
      </p>
    </div>
  );
}
