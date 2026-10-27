// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import axe from "axe-core";

import { Checkbox } from "./checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "./field";
import { Input } from "./input";
import { NativeSelect } from "./native-select";
import { Textarea } from "./textarea";

describe("Field", () => {
  it("REQ-UI-3: associates the label with a simple control", () => {
    render(
      <Field label="Nome">
        <Input />
      </Field>,
    );

    expect(screen.getByLabelText("Nome")).toBeTruthy();
  });

  it("REQ-UI-3: links the error through aria-describedby and marks the control invalid", () => {
    render(
      <Field label="Descrição" error="Descrição é obrigatória">
        <Input />
      </Field>,
    );

    const input = screen.getByLabelText("Descrição");
    const error = screen.getByRole("alert");

    expect(error.textContent).toBe("Descrição é obrigatória");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
  });

  it("REQ-UI-3: links the description and the error together, in that order", () => {
    render(
      <Field label="CNPJ" description="Somente números" error="CNPJ inválido">
        <Input />
      </Field>,
    );

    const input = screen.getByLabelText("CNPJ");
    const description = screen.getByText("Somente números");
    const error = screen.getByRole("alert");

    expect(input.getAttribute("aria-describedby")).toBe(
      `${description.id} ${error.id}`,
    );
  });

  it("REQ-UI-3: leaves the control clean when there is no description or error", () => {
    render(
      <Field label="Nome">
        <Input />
      </Field>,
    );

    const input = screen.getByLabelText("Nome");

    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("REQ-UI-3: keeps an id and aria attributes the control already carries", () => {
    render(
      <Field label="Nome" error="Obrigatório">
        <Input id="meu-id" aria-describedby="dica-externa" />
      </Field>,
    );

    const input = screen.getByLabelText("Nome");

    expect(input.id).toBe("meu-id");
    expect(input.getAttribute("aria-describedby")).toBe("dica-externa");
  });

  it("REQ-UI-3: the composable parts still work without a label prop", () => {
    render(
      <Field>
        <FieldLabel htmlFor="email">E-mail</FieldLabel>
        <Input id="email" />
        <FieldDescription>Usado no login</FieldDescription>
        <FieldError>E-mail inválido</FieldError>
      </Field>,
    );

    expect(screen.getByLabelText("E-mail")).toBeTruthy();
    expect(screen.getByText("Usado no login")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("E-mail inválido");
    expect(screen.getByRole("group")).toBeTruthy();
  });

  it("REQ-F4-1 (roadmap 2): in composable mode a text label is associated with the control without htmlFor/id", () => {
    render(
      <>
        <Field>
          <FieldLabel>Título</FieldLabel>
          <Input />
        </Field>
        <Field>
          <FieldLabel>Observações</FieldLabel>
          <Textarea />
        </Field>
        <Field>
          <FieldLabel>Prazo</FieldLabel>
          <NativeSelect>
            <option value="30">30 dias</option>
          </NativeSelect>
        </Field>
      </>,
    );

    expect(screen.getByLabelText("Título").tagName).toBe("INPUT");
    expect(screen.getByLabelText("Observações").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Prazo").tagName).toBe("SELECT");
    // Two fields never share an id.
    expect(screen.getByLabelText("Título").id).not.toBe(
      screen.getByLabelText("Observações").id,
    );
  });

  it("REQ-F4-1: an explicit htmlFor/id still wins, and a label that wraps its control keeps association by containment", () => {
    render(
      <>
        <Field>
          <FieldLabel htmlFor="codigo">Código</FieldLabel>
          <Input id="codigo" />
        </Field>
        <Field>
          <FieldLabel>
            <Checkbox aria-label="Aceito" />
            <span>Aceito os termos</span>
          </FieldLabel>
        </Field>
      </>,
    );

    expect(screen.getByLabelText("Código").id).toBe("codigo");
    const wrapping = screen.getByText("Aceito os termos").closest("label");
    expect(wrapping?.hasAttribute("for")).toBe(false);
  });

  it("REQ-F4-2: a composable form passes axe (labels, ids, aria)", async () => {
    const { container } = render(
      <form>
        <Field>
          <FieldLabel>Cliente</FieldLabel>
          <Input />
          <FieldDescription>Razão social</FieldDescription>
        </Field>
        <Field label="Título" error="Obrigatório">
          <Input />
        </Field>
        <Field>
          <FieldLabel>Observações</FieldLabel>
          <Textarea />
        </Field>
      </form>,
    );

    const results = await axe.run(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
