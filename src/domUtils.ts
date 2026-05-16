/**
 * Function for concisely creating a chunk of HTML nodes.
 */
export const h = (
  tagName: string,
  attrs?: Record<string, unknown> | null,
  children?: Node[],
): HTMLElement => {
  const el = document.createElement(tagName);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'dataset' && value && typeof value === 'object') {
        for (const [dataKey, dataVal] of Object.entries(value as Record<string, unknown>)) {
          el.dataset[dataKey] = dataVal == null ? '' : String(dataVal);
        }
      } else {
        (el as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }
  children?.forEach(child => el.appendChild(child));
  return el;
};

/**
 * Useful little template literal tagging function to make template strings behave more like JSX
 * taken almost verbatim from https://blog.jim-nielsen.com/2019/jsx-like-syntax-for-tagged-template-literals/
 */
export function jsx(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = '';
  strings.forEach((string, i) => {
    const value = values[i];

    if (Array.isArray(value)) {
      out += string + value.join('');
    } else if (typeof value === 'string') {
      out += string + value;
    } else if (typeof value === 'number') {
      out += string + String(value);
    } else {
      out += string;
    }
  });
  return out;
}

/**
 * Utility function to wrap an array of things in an HTML list.
 */
export const listify = (arrayOfThings: Array<string | object>, isOrdered: boolean): string => {
  return [
    isOrdered ? '<ol>' : '<ul>',
    ...arrayOfThings.map(i => `<li>${i}</li>`),
    isOrdered ? '</ol>' : '</ul>',
  ].join('\n');
};

export const pluralize = (quantity: number, thing: string): string => {
  return jsx`
		${quantity} ${thing}${quantity !== 1 && 's'}
	`;
};

export const CreateSvg = (
  body: string,
  width: string | number,
  height: string | number,
  classNames = '',
): SVGSVGElement => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', '0 0 24 24');
  classNames && svg.setAttribute('class', classNames);
  svg.innerHTML = body;
  return svg;
};

export const htmlToMarkdown = (html: Node): string => {
  let out = '';
  html.childNodes.forEach(nd => {
    if (nd.nodeType === Node.ELEMENT_NODE) {
      const el = nd as Element;
      switch (el.tagName) {
        case 'P':
          out += `\n${htmlToMarkdown(nd)}\n`;
          break;
        case 'STRONG':
          out += `*${nd.textContent}*`;
          break;
        case 'UL':
          out += `\n\n${htmlToMarkdown(nd)}\n`;
          break;
        case 'LI':
          out += `* ${htmlToMarkdown(nd)}\n`;
          break;
      }
    } else if (nd.nodeType == Node.TEXT_NODE) {
      out += nd.textContent;
    }
  });

  return out;
};

export const queryParams = (paramsObject: Record<string, unknown>): string => {
  return (
    '?' +
    Object.keys(paramsObject)
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(paramsObject[k]))}`)
      .join('&')
  );
};

/**
 * Centralized function to determine if the app is running in development mode.
 */
export const isDevelopmentMode = (): boolean => {
  try {
    return (
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1' ||
      location.hostname.includes('local') ||
      location.search.includes('dev=true')
    );
  } catch (_error) {
    return false;
  }
};
