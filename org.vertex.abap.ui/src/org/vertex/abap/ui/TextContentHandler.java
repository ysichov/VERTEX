package org.vertex.abap.ui;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

import com.sap.adt.communication.content.IContentHandler;
import com.sap.adt.communication.message.ByteArrayMessageBody;
import com.sap.adt.communication.message.IMessageBody;

/** Reads a standard ADT response - source as text/plain, search as XML - as a String. */
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
