//! CJK-friendly emphasis delimiters.
//!
//! CommonMark §6.2 decides whether an emphasis delimiter run may open or close
//! by looking at the characters on either side, and it counts *all* Unicode
//! punctuation as punctuation. CJK text does not separate words with spaces, so
//! a delimiter run next to a full-width mark fails both tests:
//!
//! ```text
//! 从**「爆款洗稿」**到**「角色锁定」**
//!   ↑ after 「 (punctuation), before 从 (letter)  ⇒ cannot open
//!                ↑ after 」 (punctuation), before 到 (letter) ⇒ cannot close
//! ```
//!
//! The visible result is not "no bold" but bold across the *wrong* pair: the
//! parser matches the second opener with the first closer and renders `到` bold.
//!
//! The fix follows the CJK-friendly amendment
//! (<https://github.com/tats-u/markdown-cjk-friendly>): treat CJK punctuation as
//! ordinary text when deciding flanking. The underscore word-internal rule and
//! all non-CJK text keep standard CommonMark behaviour.
//!
//! Rather than reimplement CommonMark's delimiter-run algorithm, this module
//! rewrites CJK punctuation to an ordinary CJK character before parsing. The
//! parser then makes the amended decision by itself. Two properties make the
//! rewrite safe:
//!
//! * every replaced character is 3 bytes and every replacement is 3 bytes, so
//!   all byte offsets — and therefore every parsed range — stay valid against
//!   the original source;
//! * the replacement is a letter, so it is "not punctuation" and "not
//!   whitespace", which is exactly the amended classification.

/// Ordinary CJK letter used as the stand-in. 3 bytes, like every character this
/// module replaces.
const CJK_LETTER_STAND_IN: char = '一';

/// Whether `ch` is CJK punctuation that the amendment reclassifies as text.
///
/// The ranges are the CJK Symbols and Punctuation block, vertical forms,
/// CJK compatibility forms, and half/full-width forms. Characters in those
/// blocks that are alphanumeric (full-width letters and digits), whitespace or
/// control are excluded: the amendment only moves *punctuation*, and rewriting
/// a letter would change `_` word-internal behaviour.
fn is_cjk_punctuation(ch: char) -> bool {
    if ch.is_alphanumeric() || ch.is_whitespace() || ch.is_control() {
        return false;
    }
    matches!(
        ch as u32,
        0x3000..=0x303F | 0xFE10..=0xFE1F | 0xFE30..=0xFE4F | 0xFF00..=0xFFEF
    )
}

/// Whether the source contains any CJK punctuation at all.
///
/// Callers use this to skip the rewrite entirely for the overwhelmingly common
/// case of a document with no CJK punctuation, so the hot parse path pays only a
/// scan.
pub fn contains_cjk_punctuation(source: &str) -> bool {
    source.chars().any(is_cjk_punctuation)
}

/// Rewrites CJK punctuation to an ordinary letter so the parser applies the
/// CJK-friendly flanking rule.
///
/// The returned string has exactly the same byte length as `source`, so offsets
/// in its parse tree are valid offsets into `source`. Callers must slice content
/// from the original source, not from the returned string, or they will see the
/// stand-in letter instead of the user's punctuation.
pub fn with_cjk_friendly_flanking(source: &str) -> String {
    let mut rewritten = String::with_capacity(source.len());
    for ch in source.chars() {
        if is_cjk_punctuation(ch) {
            // Both are 3 bytes, so offsets are preserved. If a future Unicode
            // revision made that untrue this assertion fires in tests instead of
            // silently shifting every downstream range.
            debug_assert_eq!(ch.len_utf8(), CJK_LETTER_STAND_IN.len_utf8());
            rewritten.push(CJK_LETTER_STAND_IN);
        } else {
            rewritten.push(ch);
        }
    }
    rewritten
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The audit sample. Without the rewrite the parser bolds `到` instead.
    const AUDIT_SAMPLE: &str =
        "本文档整理了从**「爆款洗稿（视频/小说逆向拆解）」**到**「角色锁定」**的完整落地路径";

    #[test]
    fn rewrite_preserves_byte_length_and_offsets() {
        let rewritten = with_cjk_friendly_flanking(AUDIT_SAMPLE);
        assert_eq!(
            rewritten.len(),
            AUDIT_SAMPLE.len(),
            "offsets into the rewritten source must be valid in the original"
        );
        assert_eq!(rewritten.chars().count(), AUDIT_SAMPLE.chars().count());
    }

    #[test]
    fn rewrite_keeps_ascii_and_cjk_letters_untouched() {
        let source = "plain **bold** and 中文";
        assert_eq!(with_cjk_friendly_flanking(source), source);
        assert!(!contains_cjk_punctuation(source));
    }

    #[test]
    fn detects_full_width_punctuation() {
        assert!(contains_cjk_punctuation("「引用」"));
        assert!(contains_cjk_punctuation("（括号）"));
        assert!(contains_cjk_punctuation("句号。"));
    }

    #[test]
    fn full_width_letters_and_digits_are_not_punctuation() {
        // Full-width letters live in the same block but are alphanumeric, so the
        // amendment must leave them alone.
        assert!(!contains_cjk_punctuation("ＡＢＣ１２３"));
    }

    #[test]
    fn rewrite_replaces_each_punctuation_character_with_one_letter() {
        let rewritten = with_cjk_friendly_flanking("「a」");
        assert_eq!(rewritten, "一a一");
    }
}
