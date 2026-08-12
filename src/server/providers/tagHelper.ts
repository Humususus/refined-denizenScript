/**
 * Parser for Denizen tag plaintext (e.g. `player.flag[my_flag].expiration||fallback`),
 * structurally ported from `TagHelper.Parse` and the `SingleTag`/`SingleTag.Part`
 * classes in:
 *   DenizenVSCode/DenizenLangServer/SharpDenizenTools/SharpDenizenTools/MetaHandlers/TagHelper.cs:20-91
 *
 * `parseTag` lowercases its input up front, exactly as `TagHelper.Parse` does at
 * TagHelper.cs:21 (`tag = tag.ToLowerFast();`). Because lowercasing never changes
 * the length of the ASCII tag text this parser handles, the `startChar`/`endChar`
 * offsets below index the same positions in the caller's original string as they
 * do in the lowercased copy parsed here.
 */

/** A single dot-separated part of a tag (e.g. `flag` in `player.flag[x]`). */
export interface TagPart {
    /** The tag part's text (tag name), trimmed of surrounding whitespace. */
    text: string;
    /** The bracketed context parameter for this part, if any. */
    parameter: string | null;
    /** Index in the parsed (lowercased) string where this part started. */
    startChar: number;
    /** Index in the parsed (lowercased) string where this part ended. */
    endChar: number;
}

/** A fully parsed single tag. */
export interface SingleTag {
    /** The dot-separated parts of the tag. */
    parts: TagPart[];
    /** The tag's fallback text (after `||`), if any. Left unparsed, as in the C# source. */
    fallback: string | null;
    /** Index of either where the tag ends, or where a fallback begins. */
    endChar: number;
}

/** Matches the whitespace characters recognized by `TagHelper.Whitespace` (TagHelper.cs:16). */
function isWhitespace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
}

/**
 * Parses the plaintext of a tag into its dot-separated parts, bracketed
 * parameters, and optional fallback. Structural port of `TagHelper.Parse`
 * (TagHelper.cs:19-89); variable names (`brackets`, `firstBracket`, `start`,
 * `foundABracket`, `declaredMisformat`) match the C# so the two can be
 * checked line by line.
 */
export function parseTag(tag: string, trackError: (message: string) => void): SingleTag {
    tag = tag.toLowerCase();
    let brackets = 0;
    let firstBracket = 0;
    let start = 0;
    let foundABracket = false;
    const output: SingleTag = { parts: [], fallback: null, endChar: 0 };
    let declaredMisformat = false;
    for (let i = 0; i < tag.length; i++) {
        const ch = tag[i];
        if (ch === '[') {
            brackets++;
            if (brackets === 1) {
                output.parts.push({ text: tag.substring(start, i).trim(), parameter: null, startChar: start, endChar: i });
                foundABracket = true;
                start = i;
                firstBracket = i;
            }
        }
        else if (ch === ']') {
            brackets--;
            if (brackets === -1) {
                trackError("Invalid tag format, too many ']' symbols");
            }
            if (brackets === 0) {
                const last = output.parts[output.parts.length - 1];
                last.parameter = tag.substring(firstBracket + 1, i);
                last.endChar = i;
            }
        }
        else if (ch === '.' && brackets === 0) {
            if (!foundABracket) {
                output.parts.push({ text: tag.substring(start, i).trim(), parameter: null, startChar: start, endChar: i - 1 });
            }
            foundABracket = false;
            start = i + 1;
        }
        else if (ch === '|' && brackets === 0 && i + 1 < tag.length && tag[i + 1] === '|') {
            if (!foundABracket) {
                output.parts.push({ text: tag.substring(start, i).trim(), parameter: null, startChar: start, endChar: i - 1 });
            }
            output.endChar = i;
            output.fallback = tag.substring(i + 2);
            return output;
        }
        else if (foundABracket && brackets === 0 && !declaredMisformat && !isWhitespace(ch)) {
            declaredMisformat = true;
            trackError("Invalid tag format, text after closing ']' symbol before '.' symbol");
        }
    }
    if (brackets !== 0) {
        trackError("Invalid tag format, too many '[' symbols");
    }
    if (!foundABracket) {
        output.parts.push({ text: tag.substring(start).trim(), parameter: null, startChar: start, endChar: tag.length - 1 });
    }
    output.endChar = tag.length;
    return output;
}
