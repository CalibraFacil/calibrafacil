/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { ReactNode } from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import { emailTailwindConfig, emailTheme } from "./theme";

export const theme = emailTheme;

export const styles = {
  body: "rounded-[8px] bg-bg-2 px-[40px] py-[52px] text-center",
  eyebrow:
    "m-0 mb-3 font-sans text-[12px] font-bold uppercase leading-[1.35] tracking-[0.08em] text-brand",
  title:
    "m-0 mb-4 font-sans text-[28px] font-semibold leading-[1.3] tracking-[-0.084px] text-fg [text-wrap:balance]",
  paragraph:
    "mx-auto mt-0 mb-6 max-w-[420px] font-sans text-[15px] font-[420] leading-[1.6] tracking-[-0.045px] text-fg-2 [text-wrap:pretty]",
  highlightBox: "mb-6 rounded-[10px] bg-bg px-5 py-5 text-left shadow-sm",
  highlightLabel:
    "m-0 mb-2 block font-sans text-[11px] font-bold uppercase leading-[1.5] tracking-[0.08em] text-fg-3",
  highlightValue:
    "m-0 font-mono text-[21px] font-bold leading-[1.2] tracking-[0.02em] text-brand tabular-nums",
} as const;

interface EmailLayoutProps {
  previewText: string;
  children: ReactNode;
  footerNote?: string;
  logoSrc?: string;
}

export function EmailLayout({
  previewText,
  children,
  footerNote,
  logoSrc = "/static/calibrafacil-logo.png",
}: EmailLayoutProps) {
  return (
    <Tailwind config={emailTailwindConfig}>
      <Html lang="pt-BR">
        <Head />
        <Preview>{previewText}</Preview>
        <Body className="m-0 bg-bg-2 text-center font-sans antialiased">
          <Container className="mx-auto mt-8 w-full max-w-[640px] bg-bg">
            <Section className="bg-bg px-6 py-4">
              <Section className="mb-3 px-6">
                <Row>
                  <Column className="w-1/2 py-[7px] align-middle">
                    <Img
                      src={logoSrc}
                      alt="CalibraFácil"
                      width={24}
                      height={24}
                      className="block rounded-[7px] outline outline-1 outline-[rgba(0,0,0,0.1)]"
                    />
                  </Column>
                  <Column align="right" className="w-1/2 py-[7px] align-middle">
                    <Text className="m-0 text-right font-sans text-[13px] font-[420] leading-[1.5] tracking-[-0.039px] text-fg-3">
                      CalibraFácil
                    </Text>
                  </Column>
                </Row>
              </Section>

              {children}

              <Section className="bg-bg px-6 py-10 text-center">
                <Text className="mx-auto mt-0 mb-8 max-w-[320px] font-sans text-[13px] font-[420] leading-[1.5] tracking-[-0.039px] text-fg-3">
                  CalibraFácil organiza calibrações, documentos e atendimento em
                  um único ambiente operacional.
                </Text>
                <Text className="m-0 text-center font-sans text-[11px] font-[420] leading-[1.5] tracking-[-0.033px] text-fg-3">
                  © {new Date().getFullYear()} CalibraFácil. Todos os direitos
                  reservados.
                </Text>
              </Section>
            </Section>

            {footerNote && (
              <Text className="mx-auto mt-4 mb-0 max-w-[520px] px-6 text-center font-sans text-[12px] font-[420] leading-[1.5] text-fg-3">
                {footerNote}
              </Text>
            )}
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
}

interface EmailCardProps {
  children: ReactNode;
  logoSrc?: string;
}

export function EmailCard({
  children,
  logoSrc = "/static/calibrafacil-logo.png",
}: EmailCardProps) {
  return (
    <Section className={styles.body}>
      {logoSrc && (
        <Img
          src={logoSrc}
          alt="CalibraFácil"
          width={48}
          height={48}
          className="mx-auto mb-5 block rounded-[12px] outline outline-1 outline-[rgba(0,0,0,0.1)]"
        />
      )}
      {children}
    </Section>
  );
}

interface TextProps {
  children: ReactNode;
}

export function Eyebrow({ children }: TextProps) {
  return <Text className={styles.eyebrow}>{children}</Text>;
}

export function Title({ children }: TextProps) {
  return (
    <Heading as="h1" className={styles.title}>
      {children}
    </Heading>
  );
}

export function Paragraph({ children }: TextProps) {
  return <Text className={styles.paragraph}>{children}</Text>;
}

type Tone = "default" | "success" | "warning" | "error" | "info";

const toneClasses: Record<Tone, string> = {
  default: "bg-bg text-fg-2 shadow-sm",
  success: "bg-success-bg text-success-text shadow-[inset_0_0_0_1px_#9fe3bd]",
  warning: "bg-warning-bg text-warning-text shadow-[inset_0_0_0_1px_#f4c95d]",
  error: "bg-error-bg text-error-text shadow-[inset_0_0_0_1px_#f3aaa4]",
  info: "bg-info-bg text-info-text shadow-[inset_0_0_0_1px_#9fc6ff]",
};

interface StatusBoxProps {
  variant: Exclude<Tone, "default">;
  children: ReactNode;
}

export function StatusBox({ variant, children }: StatusBoxProps) {
  return (
    <Section
      className={`mb-6 rounded-[10px] px-4 py-4 ${toneClasses[variant]}`}
    >
      <Text className="m-0 font-sans text-[14px] font-[420] leading-[1.55]">
        {children}
      </Text>
    </Section>
  );
}

interface DetailBoxProps {
  children: ReactNode;
  tone?: Tone;
}

export function DetailBox({ children, tone = "default" }: DetailBoxProps) {
  return (
    <Section
      className={`mb-6 rounded-[10px] px-5 py-5 text-left ${toneClasses[tone]}`}
    >
      {children}
    </Section>
  );
}

interface DetailRowProps {
  label: string;
  value: ReactNode;
}

export function DetailRow({ label, value }: DetailRowProps) {
  return (
    <Section className="mb-[15px] text-left">
      <Text className={styles.highlightLabel}>{label}</Text>
      <Text className="m-0 font-sans text-[15px] font-bold leading-[1.45] text-fg">
        {value}
      </Text>
    </Section>
  );
}

interface HighlightValueProps {
  children: ReactNode;
  tone?: Exclude<Tone, "default">;
}

export function HighlightValue({
  children,
  tone = "info",
}: HighlightValueProps) {
  const textClass =
    tone === "success"
      ? "text-success-text"
      : tone === "warning"
        ? "text-warning-text"
        : tone === "error"
          ? "text-error-text"
          : "text-brand";

  return (
    <span className={`${styles.highlightValue} ${textClass}`}>{children}</span>
  );
}

interface BadgeProps {
  children: ReactNode;
  variant: Exclude<Tone, "default">;
}

export function Badge({ children, variant }: BadgeProps) {
  return (
    <Text
      className={`mx-auto mt-0 mb-4 inline-block rounded-full px-4 py-2 font-sans text-[12px] font-bold uppercase leading-[1.2] tracking-[0.05em] ${toneClasses[variant]}`}
    >
      {children}
    </Text>
  );
}

interface ActionButtonProps {
  href: string;
  children: ReactNode;
  secondary?: boolean;
}

export function ActionButton({ href, children, secondary }: ActionButtonProps) {
  return (
    <Button
      href={href}
      className={
        secondary
          ? "inline-block rounded-[8px] border border-button-border bg-bg px-[20px] py-[12px] text-center font-sans text-[15px] font-bold leading-[1.5] text-fg"
          : "inline-block rounded-[8px] border border-button-border bg-bg px-[20px] py-[12px] text-center font-sans text-[15px] font-bold leading-[1.5] text-brand"
      }
    >
      {children}
    </Button>
  );
}

interface LinkFallbackProps {
  url: string;
}

export function LinkFallback({ url }: LinkFallbackProps) {
  return (
    <>
      <Text className="mx-auto mt-5 mb-0 max-w-[400px] font-sans text-[12px] font-[420] leading-[1.55] text-fg-3">
        Se o botão não funcionar, copie e cole o link abaixo no navegador:
      </Text>
      <Text className="mx-auto mt-2 mb-0 max-w-[400px] break-all font-sans text-[11px] font-[420] leading-[1.5] text-fg-3">
        {url}
      </Text>
    </>
  );
}

interface TextLinkProps {
  href: string;
  children: ReactNode;
}

export function TextLink({ href, children }: TextLinkProps) {
  return (
    <Link href={href} className="font-bold text-brand no-underline">
      {children}
    </Link>
  );
}
