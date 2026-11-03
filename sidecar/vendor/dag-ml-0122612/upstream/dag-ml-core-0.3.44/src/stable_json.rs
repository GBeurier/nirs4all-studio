//! JSON serialization with sorted map keys and unchanged struct field order.
//! Preserves existing digests while making embedded Values independent of
//! serde_json's optional `preserve_order` feature. Arrays and structs write
//! directly into the final buffer; only maps buffer fields for key sorting.
use serde::ser::{self, Serialize, SerializeMap, SerializeSeq, SerializeStruct};

pub(crate) fn to_vec<T: Serialize + ?Sized>(value: &T) -> serde_json::Result<Vec<u8>> {
    let mut output = Vec::with_capacity(128);
    value.serialize(Serializer {
        output: &mut output,
    })?;
    Ok(output)
}

struct Serializer<'a> {
    output: &'a mut Vec<u8>,
}
struct Array<'a> {
    output: &'a mut Vec<u8>,
    first: bool,
    tagged: bool,
}
struct Object<'a> {
    output: &'a mut Vec<u8>,
    values: Vec<(String, Vec<u8>)>,
    key: Option<String>,
}
struct Struct<'a> {
    output: &'a mut Vec<u8>,
    first: bool,
    tagged: bool,
}

fn write_string(output: &mut Vec<u8>, value: &str) -> serde_json::Result<()> {
    serde_json::to_writer(output, value)
}
fn open_tag(output: &mut Vec<u8>, name: &str) -> serde_json::Result<()> {
    output.push(b'{');
    write_string(output, name)?;
    output.push(b':');
    Ok(())
}
macro_rules! scalar {
    ($($method:ident($ty:ty)),*) => {$(
        fn $method(self, value: $ty) -> serde_json::Result<()> {
            ser::Serializer::$method(&mut serde_json::Serializer::new(self.output), value)
        }
    )*};
}
impl<'a> ser::Serializer for Serializer<'a> {
    type Ok = ();
    type Error = serde_json::Error;
    type SerializeSeq = Array<'a>;
    type SerializeTuple = Array<'a>;
    type SerializeTupleStruct = Array<'a>;
    type SerializeTupleVariant = Array<'a>;
    type SerializeMap = Object<'a>;
    type SerializeStruct = Struct<'a>;
    type SerializeStructVariant = Struct<'a>;
    scalar!(
        serialize_bool(bool),
        serialize_i8(i8),
        serialize_i16(i16),
        serialize_i32(i32),
        serialize_i64(i64),
        serialize_i128(i128),
        serialize_u8(u8),
        serialize_u16(u16),
        serialize_u32(u32),
        serialize_u64(u64),
        serialize_u128(u128),
        serialize_f32(f32),
        serialize_f64(f64),
        serialize_char(char),
        serialize_str(&str),
        serialize_bytes(&[u8])
    );
    fn serialize_none(self) -> serde_json::Result<()> {
        self.serialize_unit()
    }
    fn serialize_unit(self) -> serde_json::Result<()> {
        self.output.extend_from_slice(b"null");
        Ok(())
    }
    fn serialize_unit_struct(self, _: &'static str) -> serde_json::Result<()> {
        self.serialize_unit()
    }
    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> serde_json::Result<()> {
        value.serialize(self)
    }
    fn serialize_newtype_struct<T: Serialize + ?Sized>(
        self,
        _: &'static str,
        value: &T,
    ) -> serde_json::Result<()> {
        value.serialize(self)
    }
    fn serialize_unit_variant(
        self,
        _: &'static str,
        _: u32,
        name: &'static str,
    ) -> serde_json::Result<()> {
        write_string(self.output, name)
    }
    fn serialize_newtype_variant<T: Serialize + ?Sized>(
        self,
        _: &'static str,
        _: u32,
        name: &'static str,
        value: &T,
    ) -> serde_json::Result<()> {
        open_tag(self.output, name)?;
        value.serialize(Serializer {
            output: &mut *self.output,
        })?;
        self.output.push(b'}');
        Ok(())
    }
    fn serialize_seq(self, _: Option<usize>) -> serde_json::Result<Array<'a>> {
        self.output.push(b'[');
        Ok(Array {
            output: self.output,
            first: true,
            tagged: false,
        })
    }
    fn serialize_tuple(self, len: usize) -> serde_json::Result<Array<'a>> {
        self.serialize_seq(Some(len))
    }
    fn serialize_tuple_struct(self, _: &'static str, len: usize) -> serde_json::Result<Array<'a>> {
        self.serialize_tuple(len)
    }
    fn serialize_tuple_variant(
        self,
        _: &'static str,
        _: u32,
        name: &'static str,
        _: usize,
    ) -> serde_json::Result<Array<'a>> {
        open_tag(self.output, name)?;
        self.output.push(b'[');
        Ok(Array {
            output: self.output,
            first: true,
            tagged: true,
        })
    }
    fn serialize_map(self, _: Option<usize>) -> serde_json::Result<Object<'a>> {
        Ok(Object {
            output: self.output,
            values: Vec::new(),
            key: None,
        })
    }
    fn serialize_struct(self, _: &'static str, _: usize) -> serde_json::Result<Struct<'a>> {
        self.output.push(b'{');
        Ok(Struct {
            output: self.output,
            first: true,
            tagged: false,
        })
    }
    fn serialize_struct_variant(
        self,
        _: &'static str,
        _: u32,
        name: &'static str,
        _: usize,
    ) -> serde_json::Result<Struct<'a>> {
        open_tag(self.output, name)?;
        self.output.push(b'{');
        Ok(Struct {
            output: self.output,
            first: true,
            tagged: true,
        })
    }
}
impl SerializeSeq for Array<'_> {
    type Ok = ();
    type Error = serde_json::Error;
    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> serde_json::Result<()> {
        let start = self.output.len();
        if !self.first {
            self.output.push(b',');
        }
        let result = value.serialize(Serializer {
            output: &mut *self.output,
        });
        match result {
            Ok(()) => {
                self.first = false;
                Ok(())
            }
            Err(error) => {
                // A custom Serialize implementation may recover from this
                // error and continue the enclosing sequence.
                self.output.truncate(start);
                Err(error)
            }
        }
    }
    fn end(self) -> serde_json::Result<()> {
        self.output.push(b']');
        if self.tagged {
            self.output.push(b'}');
        }
        Ok(())
    }
}
macro_rules! array_impl {
    ($trait:ident, $method:ident) => {
        impl ser::$trait for Array<'_> {
            type Ok = ();
            type Error = serde_json::Error;
            fn $method<T: Serialize + ?Sized>(&mut self, value: &T) -> serde_json::Result<()> {
                SerializeSeq::serialize_element(self, value)
            }
            fn end(self) -> serde_json::Result<()> {
                SerializeSeq::end(self)
            }
        }
    };
}
array_impl!(SerializeTuple, serialize_element);
array_impl!(SerializeTupleStruct, serialize_field);
array_impl!(SerializeTupleVariant, serialize_field);
impl Object<'_> {
    fn finish(mut self) -> serde_json::Result<()> {
        self.values.sort_by(|a, b| a.0.cmp(&b.0));
        self.output.push(b'{');
        for (index, (key, value)) in self.values.into_iter().enumerate() {
            if index != 0 {
                self.output.push(b',');
            }
            write_string(self.output, &key)?;
            self.output.push(b':');
            self.output.extend_from_slice(&value);
        }
        self.output.push(b'}');
        Ok(())
    }
}
impl SerializeMap for Object<'_> {
    type Ok = ();
    type Error = serde_json::Error;
    fn serialize_key<T: Serialize + ?Sized>(&mut self, key: &T) -> serde_json::Result<()> {
        let raw = String::from_utf8(to_vec(key)?).expect("JSON serialization emits valid UTF-8");
        self.key = Some(if raw.starts_with('"') {
            serde_json::from_str(&raw)?
        } else {
            raw
        });
        Ok(())
    }
    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> serde_json::Result<()> {
        let key = self
            .key
            .take()
            .ok_or_else(|| <serde_json::Error as ser::Error>::custom("map value without key"))?;
        self.values.push((key, to_vec(value)?));
        Ok(())
    }
    fn end(self) -> serde_json::Result<()> {
        self.finish()
    }
}
impl Struct<'_> {
    fn finish(self) -> serde_json::Result<()> {
        self.output.push(b'}');
        if self.tagged {
            self.output.push(b'}');
        }
        Ok(())
    }
}
impl SerializeStruct for Struct<'_> {
    type Ok = ();
    type Error = serde_json::Error;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> serde_json::Result<()> {
        let start = self.output.len();
        if !self.first {
            self.output.push(b',');
        }
        let result = (|| {
            write_string(self.output, key)?;
            self.output.push(b':');
            value.serialize(Serializer {
                output: &mut *self.output,
            })
        })();
        match result {
            Ok(()) => {
                self.first = false;
                Ok(())
            }
            Err(error) => {
                // Discard the complete field prefix and any partial child.
                self.output.truncate(start);
                Err(error)
            }
        }
    }
    fn end(self) -> serde_json::Result<()> {
        self.finish()
    }
}
impl ser::SerializeStructVariant for Struct<'_> {
    type Ok = ();
    type Error = serde_json::Error;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> serde_json::Result<()> {
        SerializeStruct::serialize_field(self, key, value)
    }
    fn end(self) -> serde_json::Result<()> {
        self.finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovered_child_errors_preserve_complete_json() {
        use serde::ser::{
            SerializeStructVariant, SerializeTuple, SerializeTupleStruct, SerializeTupleVariant,
        };

        struct Fails {
            partial: bool,
        }
        impl Serialize for Fails {
            fn serialize<S: ser::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                if self.partial {
                    let mut sequence = serializer.serialize_seq(None)?;
                    sequence.serialize_element(&91)?;
                }
                Err(ser::Error::custom("intentional child failure"))
            }
        }
        struct Recovers {
            kind: u8,
            partial: bool,
            preceding: bool,
        }
        impl Serialize for Recovers {
            fn serialize<S: ser::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                let failing = Fails {
                    partial: self.partial,
                };
                let length = if self.preceding { 2 } else { 1 };
                macro_rules! elements {
                    ($container:expr, $method:ident) => {{
                        let mut container = $container;
                        if self.preceding {
                            container.$method(&1)?;
                        }
                        for _ in 0..2 {
                            assert!(container.$method(&failing).is_err());
                        }
                        container.$method(&2)?;
                        container.end()
                    }};
                }
                macro_rules! fields {
                    ($container:expr) => {{
                        let mut container = $container;
                        if self.preceding {
                            container.serialize_field("good", &1)?;
                        }
                        for _ in 0..2 {
                            assert!(container.serialize_field("bad", &failing).is_err());
                        }
                        container.serialize_field("tail", &2)?;
                        container.end()
                    }};
                }
                match self.kind {
                    0 => elements!(serializer.serialize_seq(Some(length))?, serialize_element),
                    1 => elements!(serializer.serialize_tuple(length)?, serialize_element),
                    2 => elements!(
                        serializer.serialize_tuple_struct("Example", length)?,
                        serialize_field
                    ),
                    3 => elements!(
                        serializer.serialize_tuple_variant("Example", 0, "Tagged", length)?,
                        serialize_field
                    ),
                    4 => fields!(serializer.serialize_struct("Example", length)?),
                    _ => {
                        fields!(serializer.serialize_struct_variant("Example", 0, "Tagged", length)?)
                    }
                }
            }
        }
        for kind in 0..6 {
            for partial in [false, true] {
                for preceding in [false, true] {
                    let value = Recovers {
                        kind,
                        partial,
                        preceding,
                    };
                    let items = if preceding { "1,2" } else { "2" };
                    let fields = if preceding {
                        r#""good":1,"tail":2"#
                    } else {
                        r#""tail":2"#
                    };
                    let expected = match kind {
                        0..=2 => format!("[{items}]"),
                        3 => format!(r#"{{"Tagged":[{items}]}}"#),
                        4 => format!("{{{fields}}}"),
                        _ => format!(r#"{{"Tagged":{{{fields}}}}}"#),
                    };
                    let actual = to_vec(&value).unwrap();
                    assert_eq!(actual, expected.as_bytes());
                    assert!(serde_json::from_slice::<serde_json::Value>(&actual).is_ok());
                }
            }
        }
    }

    #[test]
    fn preserves_tagged_and_escaped_serialization_bytes() {
        #[derive(serde::Serialize)]
        enum Example {
            Empty,
            Newtype(String),
            Tuple(u64, Vec<bool>),
            Struct { z: String, a: Option<f64> },
        }
        let cases = [
            (Example::Empty, r#""Empty""#),
            (
                Example::Newtype("line\n\"é".into()),
                r#"{"Newtype":"line\n\"é"}"#,
            ),
            (
                Example::Tuple(7, vec![true, false]),
                r#"{"Tuple":[7,[true,false]]}"#,
            ),
            (
                Example::Struct {
                    z: "\u{0000}".into(),
                    a: Some(-0.0),
                },
                r#"{"Struct":{"z":"\u0000","a":-0.0}}"#,
            ),
        ];
        for (value, expected) in cases {
            assert_eq!(to_vec(&value).unwrap(), expected.as_bytes());
        }
        assert_eq!(to_vec(&Vec::<u64>::new()).unwrap(), b"[]");
        assert_eq!(
            to_vec(&std::collections::BTreeMap::<String, u64>::new()).unwrap(),
            b"{}"
        );
    }

    #[test]
    fn sorts_values_without_changing_struct_order() {
        #[derive(serde::Serialize)]
        struct Example {
            z: u64,
            a: serde_json::Value,
        }
        let value = Example {
            z: 1,
            a: serde_json::from_str(r#"{"z":2,"a":{"z":3,"a":4}}"#).unwrap(),
        };
        assert_eq!(
            String::from_utf8(to_vec(&value).unwrap()).unwrap(),
            r#"{"z":1,"a":{"a":{"a":4,"z":3},"z":2}}"#
        );
    }
}
