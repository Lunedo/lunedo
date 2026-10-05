import { DOMParser, type Document, type Element } from "@xmldom/xmldom";

export const SAML_PROTOCOL = "urn:oasis:names:tc:SAML:2.0:protocol";
export const SAML_ASSERTION = "urn:oasis:names:tc:SAML:2.0:assertion";
export const SAML_METADATA = "urn:oasis:names:tc:SAML:2.0:metadata";
export const XML_DSIG = "http://www.w3.org/2000/09/xmldsig#";
export const XML_ENC = "http://www.w3.org/2001/04/xmlenc#";

export class XmlError extends Error {
  override name = "XmlError";
}

export function parseXml(text: string): Document {
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) {
    throw new XmlError("Documents with a document type declaration are not accepted");
  }
  try {
    return new DOMParser({
      onError: (level, message) => {
        if (level !== "warning") throw new XmlError(message);
      },
    }).parseFromString(text, "text/xml");
  } catch (error) {
    throw new XmlError(`The XML is not well-formed: ${(error as Error).message}`);
  }
}

export function children(parent: Element, namespace: string, localName: string): Element[] {
  const found: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== node.ELEMENT_NODE) continue;
    const element = node as Element;
    if (element.namespaceURI === namespace && element.localName === localName) found.push(element);
  }
  return found;
}

export function child(parent: Element, namespace: string, localName: string): Element | null {
  const found = children(parent, namespace, localName);
  if (found.length > 1) throw new XmlError(`More than one ${localName} element`);
  return found[0] ?? null;
}

export function descendants(parent: Element | Document, namespace: string, localName: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS(namespace, localName));
}

export function textOf(element: Element | null): string | null {
  if (!element) return null;
  let text = "";
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === node.TEXT_NODE || node.nodeType === node.CDATA_SECTION_NODE) {
      text += node.nodeValue ?? "";
    } else if (node.nodeType === node.ELEMENT_NODE) {
      throw new XmlError(`The element ${element.localName} contains elements instead of text`);
    }
  }
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

export function attributeOf(element: Element, name: string): string | null {
  return element.hasAttribute(name) ? element.getAttribute(name) : null;
}
