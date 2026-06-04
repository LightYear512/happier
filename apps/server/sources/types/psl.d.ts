declare module 'psl' {
    export interface ParsedDomain {
        domain: string | null;
        error?: never;
    }

    export interface ParseError {
        domain?: never;
        error: unknown;
    }

    export function parse(hostname: string): ParsedDomain | ParseError;

    const psl: {
        parse: typeof parse;
    };

    export default psl;
}
