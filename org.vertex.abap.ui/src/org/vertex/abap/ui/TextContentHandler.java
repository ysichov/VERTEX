package org.vertex.abap.ui;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

import com.sap.adt.communication.content.IContentHandler;
import com.sap.adt.communication.message.ByteArrayMessageBody;
import com.sap.adt.communication.message.IMessageBody;

/**
 * Carries a body of one content type as a String, in either direction: reads a response - source as text/plain,
 * search as XML, VERTEX's own resources as JSON - and writes a String as a request.
 * <p>
 * ADT ships PlainTextContentHandler for this, but its package is internal and not exported, so the four methods are
 * implemented here instead.
 */
public class TextContentHandler implements IContentHandler<String> {

	private final String contentType;

	public TextContentHandler(String contentType) {
		this.contentType = contentType;
	}

	@Override
	public String deserialize(IMessageBody body, Class<? extends String> type) {
		try (InputStream in = body.getContent()) {
			return new String(in.readAllBytes(), StandardCharsets.UTF_8);
		} catch (IOException e) {
			throw new IllegalStateException("Cannot read the response body", e);
		}
	}

	@Override
	public IMessageBody serialize(String data, Charset charset) {
		// The charset ADT offers is whatever the destination prefers; the bodies here are source, XML and JSON, read
		// as UTF-8, so they are written as UTF-8 and said to be.
		return new ByteArrayMessageBody(contentType + "; charset=utf-8", data.getBytes(StandardCharsets.UTF_8));
	}

	@Override
	public String getSupportedContentType() {
		return contentType;
	}

	@Override
	public Class<String> getSupportedDataType() {
		return String.class;
	}
}
