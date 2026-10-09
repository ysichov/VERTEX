package org.vertex.abap.ui;

import java.util.Locale;

import org.eclipse.compare.rangedifferencer.IRangeComparator;
import org.eclipse.compare.rangedifferencer.RangeDifference;
import org.eclipse.compare.rangedifferencer.RangeDifferencer;

/**
 * The diff of two versions, computed by Eclipse's own Text Compare: RangeDifferencer over whole lines, the same
 * comparison ADT's Compare With shows. The VS Code extension computes the same kind of diff with its own
 * implementation (vscode/line-diff.js); here the platform's is used as it is.
 * <p>
 * The answer is one character per line of the result, in order: '=' a line both sides keep, '-' a line of the old
 * version, '+' a line of the new one - the old lines of a difference before its new ones. The page puts the texts
 * back, so only the shape travels.
 */
final class LineDiff {

	private LineDiff() {
	}

	/** One version's lines as RangeDifferencer compares them: by the line, or trimmed and upper case. */
	private static final class Lines implements IRangeComparator {
		private final String[] keys;

		Lines(String[] lines, boolean ignore) {
			this.keys = new String[lines.length];
			for (int i = 0; i < lines.length; i++) {
				this.keys[i] = ignore ? lines[i].trim().toUpperCase(Locale.ROOT) : lines[i];
			}
		}

		@Override
		public int getRangeCount() {
			return keys.length;
		}

		@Override
		public boolean rangesEqual(int thisIndex, IRangeComparator other, int otherIndex) {
			return keys[thisIndex].equals(((Lines) other).keys[otherIndex]);
		}

		@Override
		public boolean skipRangeComparison(int length, int maxLength, IRangeComparator other) {
			return false;
		}
	}

	/**
	 * @param ignore compare without case and indentation, as AVE's Case/ind switch does
	 */
	static String ops(String[] oldLines, String[] newLines, boolean ignore) {
		RangeDifference[] differences = RangeDifferencer.findDifferences(new Lines(oldLines, ignore),
				new Lines(newLines, ignore));
		StringBuilder ops = new StringBuilder(oldLines.length + newLines.length);
		int at = 0;
		for (RangeDifference difference : differences) {
			while (at < difference.leftStart()) {
				ops.append('=');
				at++;
			}
			for (int i = 0; i < difference.leftLength(); i++) {
				ops.append('-');
			}
			for (int i = 0; i < difference.rightLength(); i++) {
				ops.append('+');
			}
			at = difference.leftEnd();
		}
		while (at < oldLines.length) {
			ops.append('=');
			at++;
		}
		return ops.toString();
	}

	/** COUNT lines joined by line feeds; zero lines is an empty text, which split would read as one. */
	static String[] lines(String text, int count) {
		return count == 0 ? new String[0] : text.split("\n", -1);
	}
}
