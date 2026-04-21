pub fn parse_aliases(content: &str) -> Vec<String> {
    let mut out = Vec::new();
    for raw in content.lines() {
        if raw.starts_with([' ', '\t']) {
            continue;
        }
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some(eq_idx) = line.find('=') else {
            continue;
        };
        let alias = line[..eq_idx].trim();
        if alias.is_empty() {
            continue;
        }
        if !alias
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            continue;
        }
        let rest = line[eq_idx + 1..].trim_start();
        if !rest.starts_with('(') {
            continue;
        }
        out.push(alias.to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const AUTONOMOUS_SAMPLE: &str = "\
mydb_high = (DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(PORT=1522)(HOST=adb.example.oraclecloud.com))(CONNECT_DATA=(SERVICE_NAME=high.adb)))
mydb_medium = (DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(PORT=1522)(HOST=adb.example.oraclecloud.com))(CONNECT_DATA=(SERVICE_NAME=medium.adb)))
mydb_low=(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(PORT=1522)(HOST=adb.example.oraclecloud.com))(CONNECT_DATA=(SERVICE_NAME=low.adb)))
";

    #[test]
    fn parses_three_aliases_in_file_order() {
        let aliases = parse_aliases(AUTONOMOUS_SAMPLE);
        assert_eq!(aliases, vec!["mydb_high", "mydb_medium", "mydb_low"]);
    }

    #[test]
    fn ignores_comments_and_blank_lines() {
        let input = "\
# this is a comment

alpha = (DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)))

# another comment
beta=(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)))
";
        assert_eq!(parse_aliases(input), vec!["alpha", "beta"]);
    }

    #[test]
    fn ignores_indented_continuation_lines() {
        let input = "\
mydb_high = (DESCRIPTION=
    (ADDRESS=(PROTOCOL=TCPS)(PORT=1522)(HOST=h))
    (CONNECT_DATA=(SERVICE_NAME=s)))
mydb_low = (DESCRIPTION=(ADDRESS=))
";
        assert_eq!(parse_aliases(input), vec!["mydb_high", "mydb_low"]);
    }

    #[test]
    fn returns_empty_for_garbage_input() {
        assert!(parse_aliases("").is_empty());
        assert!(parse_aliases("not a tnsnames file at all").is_empty());
        assert!(parse_aliases("==== broken =====").is_empty());
    }

    #[test]
    fn preserves_alias_casing() {
        let input = "MyDB_HIGH = (DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)))\n";
        assert_eq!(parse_aliases(input), vec!["MyDB_HIGH"]);
    }
}
