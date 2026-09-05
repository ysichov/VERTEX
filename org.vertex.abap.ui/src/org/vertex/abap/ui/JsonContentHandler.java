package org.vertex.abap.ui;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

import com.sap.adt.communication.content.IContentHandler;
import com.sap.adt.communication.message.IMessageBody;

/**
 * Reads an application/json response body as a String.
 * <p>
 * ADT ships PlainTextContentHandler for this, but its package is internal and
 * not exported, so the four methods are implemented here instead.
 */
public class JsonContentHandler implements IContentHandler<String> {

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
		throw new UnsupportedOperationException("This handler only reads responses");
	}

	@Override
	public String getSupportedContentType() {
		return "application/json";
	}

	@Override
	public Class<String> getSupportedDataType() {
		return String.class;
	}
}
