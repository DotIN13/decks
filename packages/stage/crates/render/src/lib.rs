//! What every stage backend shares and that knows no graphics API: a draw list batched into passes
//! ([`batch`]), the paints and clips packed into a table ([`table`]), what a device allows
//! ([`limits`]), and the one shader every backend translates ([`shaders`]).

pub mod batch;
pub mod limits;
pub mod shaders;
pub mod table;

pub use batch::Built;
pub use limits::Limits;
pub use table::Table;
