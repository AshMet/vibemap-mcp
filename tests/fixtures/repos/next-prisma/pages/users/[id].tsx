import { getUser } from "../../lib/users";

export async function getServerSideProps(ctx: any) {
  return { props: { user: await getUser(ctx.params.id) } };
}

export default function UserPage(props: any) {
  return <pre>{JSON.stringify(props.user)}</pre>;
}
