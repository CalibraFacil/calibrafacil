// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field, FieldDescription, FieldError, FieldLabel } from "./field";
import { Input } from "./input";

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
});
