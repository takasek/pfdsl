export type TokenType =
  | 'ARROW_FEEDBACK'  // >>?
  | 'ARROW_INPUT'     // >>
  | 'ARROW_OUTPUT'    // ->
  | 'LBRACKET'        // [
  | 'RBRACKET'        // ]
  | 'COMMA'           // ,
  | 'SEMICOLON'       // ;
  | 'NEWLINE'
  | 'COMMENT'         // # ... (to EOL)
  | 'ID'
  | 'EOF';

export interface Position {
  line: number;    // 1-based
  column: number;  // 1-based
  offset: number;  // 0-based byte offset
}

export interface Token {
  type: TokenType;
  value: string;   // normalized: for ID = unquoted+unescaped; others = raw
  raw: string;     // original source text
  start: Position;
  end: Position;
}
