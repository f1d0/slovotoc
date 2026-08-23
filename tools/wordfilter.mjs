// The kid-safe filter lives in web/js/wordfilter.js so the game and the
// offline tools share one list. Two copies would drift, and a word the
// generator rejects but the name box accepts is exactly the kind of gap
// nobody notices until a child reads it out.
export * from '../web/js/wordfilter.js';
