/**
 * A small JSON Schema checker for the subset Board messages use: objects,
 * arrays, scalars, enum, required, and additionalProperties.
 * Returns the first problem, or undefined when the value matches.
 */
export const jsonSchemaError = (schema: unknown, value: unknown): string | undefined => {
  if (schema === true) return undefined;

  if (schema === false) return "rejected by schema";

  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    return "schema must be an object";
  }

  const node = schema as Record<string, unknown>;

  if (Array.isArray(node.enum) && !node.enum.some((item) => Object.is(item, value))) {
    return "value is not in enum";
  }

  const type = node.type;

  if (type === "object") return objectError(node, value);

  if (type === "array") return arrayError(node, value);

  if (type === "string") return stringError(node, value);

  if (type === "number" || type === "integer") return numberError(node, value, type);

  if (type === "boolean") return typeof value === "boolean" ? undefined : "expected boolean";

  if (type === undefined) return undefined;

  return `unsupported schema type ${String(type)}`;
};

const objectError = (node: Record<string, unknown>, value: unknown) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "expected object";
  const record = value as Record<string, unknown>;
  const properties =
    node.properties !== null &&
    typeof node.properties === "object" &&
    !Array.isArray(node.properties)
      ? (node.properties as Record<string, unknown>)
      : {};

  if (Array.isArray(node.required)) {
    for (const key of node.required) {
      if (typeof key === "string" && record[key] === undefined) return `missing ${key}`;
    }
  }

  for (const [key, property] of Object.entries(record)) {
    const child = properties[key];

    if (child === undefined) {
      if (node.additionalProperties === false) return `unexpected ${key}`;

      continue;
    }

    const problem = jsonSchemaError(child, property);

    if (problem !== undefined) return `${key}: ${problem}`;
  }

  return undefined;
};

const arrayError = (node: Record<string, unknown>, value: unknown) => {
  if (!Array.isArray(value)) return "expected array";

  if (node.items === undefined) return undefined;

  for (let i = 0; i < value.length; i++) {
    const problem = jsonSchemaError(node.items, value[i]);

    if (problem !== undefined) return `[${i}]: ${problem}`;
  }

  return undefined;
};

const stringError = (node: Record<string, unknown>, value: unknown) => {
  if (typeof value !== "string") return "expected string";

  if (typeof node.minLength === "number" && value.length < node.minLength) return "too short";

  if (typeof node.maxLength === "number" && value.length > node.maxLength) return "too long";

  return undefined;
};

const numberError = (node: Record<string, unknown>, value: unknown, type: string) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "expected number";

  if (type === "integer" && !Number.isInteger(value)) return "expected integer";

  if (typeof node.minimum === "number" && value < node.minimum) return "below minimum";

  if (typeof node.maximum === "number" && value > node.maximum) return "above maximum";

  return undefined;
};
